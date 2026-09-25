// Local, synthetic audit. No backend requests or production data.
// node scripts/performance-audit.mjs <baseline-git-ref> <build-directory>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const [baseline, buildDirectory = ".next-e2e"] = process.argv.slice(2);
if (!baseline || baseline.startsWith("-")) throw new Error("Provide a baseline Git commit or branch.");
const directory = await mkdtemp(join(tmpdir(), "lofoten-perf-"));
try {
  const sources = {
    geo: await readFile("lib/geo.ts", "utf8"),
    before: execFileSync("git", ["show", `${baseline}:lib/photo-outliers.ts`], { encoding: "utf8" }),
    after: await readFile("lib/photo-outliers.ts", "utf8"),
  };
  for (const [name, source] of Object.entries(sources)) {
    const { outputText } = ts.transpileModule(source.replace('"./geo"', '"./geo.mjs"'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    });
    await writeFile(join(directory, `${name}.mjs`), outputText);
  }
  const before = (await import(pathToFileURL(join(directory, "before.mjs")).href)).detectPhotoOutliers;
  const after = (await import(pathToFileURL(join(directory, "after.mjs")).href)).detectPhotoOutliers;
  const photos = Array.from({ length: 10000 }, (_, index) => ({
    id: String(index), lat: index % 97 === 0 ? 68 : 67.9, lng: 13,
    taken_at: new Date(Date.UTC(2026, 4, 1) + index * 60000).toISOString(),
  }));
  assert.deepEqual(after(photos), before(photos));
  const timings = {};
  for (const [label, detect] of [["before", before], ["after", after]]) {
    detect(photos);
    const samples = [];
    for (let run = 0; run < 7; run += 1) {
      const start = performance.now();
      detect(photos);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    timings[label] = { medianMs: samples[3], samplesMs: samples };
  }

  const html = await readFile(join(buildDirectory, "server/app/index.html"), "utf8");
  const scripts = [...new Set([...html.matchAll(/<script[^>]+src="([^\"]+)"/g)].map((match) => match[1]))];
  let bytes = 0;
  let gzipBytes = 0;
  for (const script of scripts) {
    assert.ok(script.startsWith("/_next/static/"));
    const content = await readFile(join(buildDirectory, script.slice("/_next/".length)));
    bytes += content.length;
    gzipBytes += gzipSync(content).length;
  }
  console.log(JSON.stringify({ baseline, node: process.version, photos: photos.length, outputsMatch: true, timings, initialScripts: { count: scripts.length, bytes, gzipBytes } }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
