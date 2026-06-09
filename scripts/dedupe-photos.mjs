// Find and remove byte-identical duplicate photos, then backfill content_hash.
//
// Duplicates are detected by downloading every stored image and hashing the
// actual bytes -- metadata (taken_at, coordinates) is only used to pick which
// copy of a duplicate group survives. Rows whose stored bytes are unique are
// never touched.
//
// Usage:
//   node scripts/dedupe-photos.mjs            # read-only: download, hash, report
//   node scripts/dedupe-photos.mjs --apply    # delete duplicates + backfill hashes
//
// Read-only mode needs only the anon key (the bucket is public). Apply mode
// needs SUPABASE_SERVICE_ROLE_KEY in the environment because photo deletes are
// admin-gated by RLS. A JSON backup of every deleted row is written either way.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const REPORT_PATH = new URL("../.dedupe-report.json", import.meta.url).pathname;
const DOWNLOAD_CONCURRENCY = 12;
const PHOTO_BUCKET = "trip-photos";

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

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
const apply = process.argv.includes("--apply");

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}
if (apply && !SERVICE_KEY) {
  console.error("--apply needs SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const writeKey = SERVICE_KEY ?? ANON_KEY;
const restHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

async function rest(path, { method = "GET", key = ANON_KEY, body } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { ...restHeaders(key), ...(method === "DELETE" || method === "PATCH" ? { Prefer: "return=minimal" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function fetchAllPhotos() {
  const photos = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`/rest/v1/photos?select=*&order=created_at&limit=1000&offset=${from}`);
    photos.push(...page);
    if (page.length < 1000) break;
  }
  return photos;
}

async function hashStoredImage(photo) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${photo.image_path}`;
  const response = await fetch(url);
  if (!response.ok) return { id: photo.id, error: `download failed (${response.status})` };
  const bytes = Buffer.from(await response.arrayBuffer());
  return { id: photo.id, storedHash: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }));
  return results;
}

// Survivor choice within a byte-identical group: keep the copy that carries the
// most human effort -- a caption beats none, then a day assignment, then the
// oldest upload (its id is what any old shared links point at).
function pickSurvivor(group) {
  return [...group].sort((a, b) =>
    (b.caption ? 1 : 0) - (a.caption ? 1 : 0)
    || (b.day_id ? 1 : 0) - (a.day_id ? 1 : 0)
    || Date.parse(a.created_at) - Date.parse(b.created_at),
  )[0];
}

const photos = await fetchAllPhotos();
console.log(`Fetched ${photos.length} photo rows. Downloading and hashing stored images...`);

let done = 0;
const hashResults = await mapWithConcurrency(photos, DOWNLOAD_CONCURRENCY, async (photo) => {
  const result = await hashStoredImage(photo);
  done += 1;
  if (done % 100 === 0) console.log(`  hashed ${done}/${photos.length}`);
  return result;
});

const failures = hashResults.filter((result) => result.error);
const hashById = new Map(hashResults.filter((result) => result.storedHash).map((result) => [result.id, result]));

const groups = new Map();
for (const photo of photos) {
  const stored = hashById.get(photo.id);
  if (!stored) continue;
  const group = groups.get(stored.storedHash) ?? [];
  group.push(photo);
  groups.set(stored.storedHash, group);
}

const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1);
const deletions = [];
for (const [storedHash, group] of duplicateGroups) {
  const survivor = pickSurvivor(group);
  for (const photo of group) {
    if (photo.id !== survivor.id) deletions.push({ storedHash, survivorId: survivor.id, row: photo });
  }
}

const survivorIds = new Set(photos.map((photo) => photo.id));
for (const deletion of deletions) survivorIds.delete(deletion.row.id);
const backfills = photos
  .filter((photo) => survivorIds.has(photo.id) && !photo.content_hash && hashById.get(photo.id))
  .map((photo) => ({ id: photo.id, content_hash: hashById.get(photo.id).storedHash }));

writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: null, totals: {
  photos: photos.length,
  hashFailures: failures.length,
  duplicateGroups: duplicateGroups.length,
  rowsToDelete: deletions.length,
  hashBackfills: backfills.length,
  bytesReclaimed: deletions.reduce((sum, deletion) => sum + (hashById.get(deletion.row.id)?.bytes ?? 0), 0),
}, failures, deletions, backfills }, null, 2));

console.log(`\nByte-identical duplicate groups: ${duplicateGroups.length}`);
console.log(`Rows to delete (keeping one per group): ${deletions.length}`);
console.log(`Surviving rows needing content_hash backfill: ${backfills.length}`);
console.log(`Storage to reclaim: ${(deletions.reduce((sum, deletion) => sum + (hashById.get(deletion.row.id)?.bytes ?? 0), 0) / 1024 / 1024).toFixed(1)} MB`);
if (failures.length > 0) console.log(`Download failures (left untouched): ${failures.length}`);
console.log(`Full report + row backup: ${REPORT_PATH}`);

if (!apply) {
  console.log("\nDry run complete. Re-run with --apply and SUPABASE_SERVICE_ROLE_KEY to clean up.");
  process.exit(0);
}

console.log("\nApplying...");
const storagePaths = deletions.flatMap(({ row }) => [row.image_path, row.thumbnail_path].filter(Boolean));
for (let from = 0; from < storagePaths.length; from += 100) {
  await rest(`/storage/v1/object/${PHOTO_BUCKET}`, { method: "DELETE", key: writeKey, body: { prefixes: storagePaths.slice(from, from + 100) } });
}
console.log(`Deleted ${storagePaths.length} storage objects.`);

for (let from = 0; from < deletions.length; from += 100) {
  const ids = deletions.slice(from, from + 100).map(({ row }) => row.id).join(",");
  await rest(`/rest/v1/photos?id=in.(${ids})`, { method: "DELETE", key: writeKey });
}
console.log(`Deleted ${deletions.length} photo rows.`);

let backfilled = 0;
for (const backfill of backfills) {
  try {
    await rest(`/rest/v1/photos?id=eq.${backfill.id}`, { method: "PATCH", key: writeKey, body: { content_hash: backfill.content_hash } });
    backfilled += 1;
  } catch (error) {
    // A unique-index hit here would mean two rows with identical bytes survived
    // -- impossible after dedupe, so surface anything that fails loudly.
    console.error(`Backfill failed for ${backfill.id}: ${error.message}`);
  }
}
console.log(`Backfilled content_hash on ${backfilled}/${backfills.length} rows. Done.`);
