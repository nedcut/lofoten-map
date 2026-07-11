// Delete storage objects in the photo bucket that no photos row references.
//
// Legacy failed batches can leave UUID-path objects behind. Content-addressed
// uploads can also leave one stable object behind when a database outcome is
// unknown. Those objects are unreachable from the app but still count against
// the storage quota.
//
// An object is an orphan only if its path appears in neither image_path nor
// thumbnail_path of any row. The live set is never touched, and objects younger
// than MIN_AGE_HOURS are always spared -- an upload whose row insert has not
// landed yet is indistinguishable from an orphan, so age is what separates them.
//
// Usage:
//   node scripts/purge-orphan-objects.mjs            # read-only: list, diff, report
// Deletion is deliberately not automated here: a reference can be created
// between any client-side confirmation and delete. Safe deletion needs a
// server-side maintenance protocol shared with uploads. The manifest is an
// inventory for inspection until that protocol exists.

import { readFileSync, writeFileSync } from "node:fs";

const REPORT_PATH = new URL("../.orphan-report.json", import.meta.url).pathname;
const PHOTO_BUCKET = "trip-photos";
// An in-flight upload looks exactly like an orphan until its row is inserted.
const MIN_AGE_HOURS = 1;

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
const apply = process.argv.includes("--apply");

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}
if (apply) {
  console.error("--apply is disabled: deletion is unsafe without a lock shared with uploads.");
  process.exit(1);
}

const restHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

async function rest(path, { method = "GET", key = ANON_KEY, body } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { ...restHeaders(key), ...(method === "DELETE" ? { Prefer: "return=minimal" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

/** Every path any row points at, across both columns. */
async function fetchReferencedPaths() {
  const referenced = new Set();
  for (let from = 0; ; from += 1000) {
    const page = await rest(`/rest/v1/photos?select=image_path,thumbnail_path&order=id.asc&limit=1000&offset=${from}`);
    for (const row of page) {
      if (row.image_path) referenced.add(row.image_path);
      if (row.thumbnail_path) referenced.add(row.thumbnail_path);
    }
    if (page.length < 1000) break;
  }
  return referenced;
}

// The list API returns one level at a time: entries with metadata are objects,
// entries without are folders to descend into.
async function listObjects(prefix = "") {
  const objects = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`/storage/v1/object/list/${PHOTO_BUCKET}`, {
      method: "POST",
      body: { prefix, limit: 1000, offset: from },
    });
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.metadata?.size === undefined || entry.metadata === null) objects.push(...await listObjects(path));
      // A retried upload upserts onto its old key, which refreshes updated_at
      // but not created_at -- judge age by the newest write so an object that
      // was just re-uploaded (insert still pending) counts as new.
      else objects.push({ path, size: entry.metadata.size, lastWriteAt: entry.updated_at ?? entry.created_at ?? null });
    }
    if (page.length < 1000) break;
  }
  return objects;
}

function partitionOrphans(objects, referenced, now) {
  const cutoff = now - MIN_AGE_HOURS * 3600 * 1000;
  const live = [];
  const orphans = [];
  const tooNew = [];
  for (const object of objects) {
    if (referenced.has(object.path)) live.push(object);
    else {
      const lastWriteAt = object.lastWriteAt ? Date.parse(object.lastWriteAt) : Number.NaN;
      if (!Number.isFinite(lastWriteAt) || lastWriteAt > cutoff) tooNew.push(object);
      else orphans.push(object);
    }
  }
  return { live, orphans, tooNew };
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const sum = (objects) => objects.reduce((total, object) => total + object.size, 0);

const referenced = await fetchReferencedPaths();
console.log(`Rows reference ${referenced.size} distinct paths. Listing bucket...`);

const objects = await listObjects();
const { live, orphans, tooNew } = partitionOrphans(objects, referenced, Date.now());
const missing = [...referenced].filter((path) => !objects.some((object) => object.path === path));

writeFileSync(REPORT_PATH, JSON.stringify({
  totals: {
    referencedPaths: referenced.size,
    objects: objects.length,
    live: live.length,
    liveBytes: sum(live),
    orphans: orphans.length,
    orphanBytes: sum(orphans),
    sparedAsTooNew: tooNew.length,
    referencedButMissing: missing.length,
  },
  orphans: orphans.map((object) => object.path),
  missing,
}, null, 2));

console.log(`\n  live (referenced)  ${String(live.length).padStart(5)} objects  ${mb(sum(live)).padStart(8)} MB`);
console.log(`  orphans            ${String(orphans.length).padStart(5)} objects  ${mb(sum(orphans)).padStart(8)} MB  <- reclaimable`);
if (tooNew.length > 0) console.log(`  spared (< ${MIN_AGE_HOURS}h old)  ${String(tooNew.length).padStart(5)} objects  ${mb(sum(tooNew)).padStart(8)} MB`);
if (missing.length > 0) console.log(`\n  WARNING: ${missing.length} referenced paths have no object -- broken rows, not touched.`);
console.log(`\n  bucket after purge: ${(sum(live) / 1024 / 1024 / 1024).toFixed(2)} GB`);
console.log(`\nManifest: ${REPORT_PATH}`);

console.log("\nInventory complete. Automatic deletion is disabled until uploads and cleanup share a server-side lock.");
