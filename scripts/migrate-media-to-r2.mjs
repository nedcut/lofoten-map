import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const credentialsFile = process.env.R2_CREDENTIALS_FILE;
const mediaRoot = process.env.MIGRATION_MEDIA_DIR;

if (!accountId || !bucket || !credentialsFile || !mediaRoot) {
  throw new Error("Set R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_CREDENTIALS_FILE, and MIGRATION_MEDIA_DIR.");
}

const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"));
if (!credentials.accessKeyId || !credentials.secretAccessKey) throw new Error("R2 credentials file is invalid.");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials,
  maxAttempts: 5,
});

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

async function mapConcurrent(items, concurrency, operation) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await operation(items[index], index);
    }
  }));
}

const root = resolve(mediaRoot);
const mediaDirectories = ["trip-photos", "avatars"];
const localFiles = mediaDirectories.flatMap((directory) => filesBelow(resolve(root, directory)));
const expected = new Map(localFiles.map((file) => {
  const key = relative(root, file).split(sep).join("/");
  return [key, statSync(file).size];
}));

async function listRemoteObjects() {
  const objects = new Map();
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (object.Key && typeof object.Size === "number") objects.set(object.Key, object.Size);
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

if (process.argv.includes("--delete-unexpected")) {
  const existing = await listRemoteObjects();
  const unexpected = [...existing.keys()].filter((key) => !mediaDirectories.some((directory) => key.startsWith(`${directory}/`)));
  for (let index = 0; index < unexpected.length; index += 1000) {
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: unexpected.slice(index, index + 1000).map((key) => ({ Key: key })), Quiet: true },
    }));
  }
  console.log(JSON.stringify({ event: "unexpected_objects_deleted", objects: unexpected.length }));
  process.exit(0);
}

await mapConcurrent(localFiles, 4, async (file, index) => {
  const key = relative(root, file).split(sep).join("/");
  const size = expected.get(key);
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(file),
      ContentLength: size,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
      IfNoneMatch: "*",
    }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
  if ((index + 1) % 50 === 0 || index + 1 === localFiles.length) {
    console.log(JSON.stringify({ event: "upload_progress", completed: index + 1, total: localFiles.length }));
  }
});

const remote = await listRemoteObjects();

const mismatches = [];
for (const [key, size] of expected) {
  if (remote.get(key) !== size) mismatches.push(key);
}
for (const key of remote.keys()) {
  if (!expected.has(key)) mismatches.push(key);
}
if (mismatches.length > 0) throw new Error(`R2 verification failed for ${mismatches.length} object(s).`);

const bytes = [...expected.values()].reduce((total, size) => total + size, 0);
console.log(JSON.stringify({ event: "verification_complete", objects: expected.size, bytes }));
