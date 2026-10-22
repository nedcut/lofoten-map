// Generate map-marker images for photos uploaded before markers existed.
//
// New uploads store three objects per item (lib/photo-upload.ts):
//   trip-photos/<slug>/<hash>.<ext>          original
//   trip-photos/<slug>/thumbs/<name>.jpg     520 px thumbnail
//   trip-photos/<slug>/markers/<name>.jpg    144 px square marker image
// The marker path is derived from thumbnail_path (markerPathFor in
// lib/object-store.ts), so no database row changes. This script lists every
// thumbnail in R2 and renders the missing marker beside it from the thumbnail
// bytes. Until it runs, old markers fall back to the thumbnail in the browser.
//
// Usage:
//   node scripts/backfill-marker-images.mjs           # dry run: list what would be written
//   node scripts/backfill-marker-images.mjs --apply   # render and upload missing markers
//
// Needs R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
// in the environment or .env.local. Writes are conditional (If-None-Match: *),
// so a rerun, or a marker a new upload stored meanwhile, is never overwritten.
// Uses sharp, which ships with Next.js.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

// Keep in step with MARKER_EDGE and MARKER_QUALITY in lib/photo-processing.ts.
const MARKER_EDGE = 144;
const MARKER_QUALITY = 76;
const PHOTO_BUCKET = "trip-photos";
const THUMBNAIL_KEY = /^trip-photos\/([^/]+)\/thumbs\/([^/]+\.jpg)$/;

/** Centre-cropped square JPEG, like renderMarkerFile in the browser. */
export async function renderMarker(thumbnail) {
  return sharp(thumbnail)
    .rotate()
    .resize(MARKER_EDGE, MARKER_EDGE, { fit: "cover", position: "centre", withoutEnlargement: true })
    .jpeg({ quality: MARKER_QUALITY, mozjpeg: true })
    .toBuffer();
}

export function markerKeyFor(thumbnailKey) {
  const match = thumbnailKey.match(THUMBNAIL_KEY);
  return match ? `${PHOTO_BUCKET}/${match[1]}/markers/${match[2]}` : null;
}

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    try {
      const line = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split("\n")
        .find((entry) => entry.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1).trim();
    } catch {
      // missing env file -- keep looking
    }
  }
  return null;
}

async function listKeys(client, bucket, prefix) {
  const keys = new Set();
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    for (const object of page.Contents ?? []) if (object.Key) keys.add(object.Key);
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = Object.fromEntries(["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].map((name) => [name, readEnv(name)]));
  const missingEnv = Object.entries(env).filter(([, value]) => !value).map(([name]) => name);
  if (missingEnv.length > 0) {
    console.error(`Missing ${missingEnv.join(", ")}.`);
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 5,
  });
  const bucket = env.R2_BUCKET_NAME;

  const keys = await listKeys(client, bucket, `${PHOTO_BUCKET}/`);
  const pending = [...keys]
    .map((thumbnailKey) => ({ thumbnailKey, markerKey: markerKeyFor(thumbnailKey) }))
    .filter((entry) => entry.markerKey && !keys.has(entry.markerKey));
  console.log(`${keys.size} objects listed; ${pending.length} thumbnails have no marker image.`);

  if (!apply) {
    for (const { markerKey } of pending.slice(0, 20)) console.log(`  would write ${markerKey}`);
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    console.log("\nDry run. Re-run with --apply to write them.");
    return;
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;
  let thumbnailBytes = 0;
  let markerBytes = 0;
  for (const { thumbnailKey, markerKey } of pending) {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: thumbnailKey }));
      const thumbnail = Buffer.from(await object.Body.transformToByteArray());
      const marker = await renderMarker(thumbnail);
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: markerKey,
        Body: marker,
        ContentLength: marker.length,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
        IfNoneMatch: "*",
      }));
      written += 1;
      thumbnailBytes += thumbnail.length;
      markerBytes += marker.length;
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status === 409 || status === 412) skipped += 1;
      else {
        failed += 1;
        console.error(`  failed ${thumbnailKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const done = written + skipped + failed;
    if (done % 50 === 0) console.log(`  ${done}/${pending.length}`);
  }
  console.log(`Wrote ${written} marker images (${skipped} already existed, ${failed} failed).`);
  if (written > 0) console.log(`Thumbnails ${(thumbnailBytes / 1024).toFixed(0)} KB -> markers ${(markerBytes / 1024).toFixed(0)} KB.`);
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
