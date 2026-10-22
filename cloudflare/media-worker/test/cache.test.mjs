import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import worker from "./src/index.ts";
      export default {
        async fetch(request, env) {
          const pending = [];
          const response = await worker.fetch(request, env, {
            waitUntil(promise) { pending.push(promise); }
          });
          // Make warming deterministic without mocking the Cache API.
          await Promise.all(pending);
          return response;
        }
      };
    `,
    resolveDir: import.meta.dirname + "/..",
  },
  bundle: true,
  format: "esm",
  write: false,
});
const config = JSON.parse((await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")));
const body = "0123456789".repeat(100);

test("cold and warm cache preserve range and conditional semantics", async (t) => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "media",
      modules: true,
      script: outputFiles[0].text,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      r2Buckets: ["MEDIA_BUCKET"],
    }],
  }));
  t.after(() => mf.dispose());
  const bucket = await mf.getR2Bucket("MEDIA_BUCKET");
  const key = "trip-photos/range-test";
  const object = await bucket.put(key, body);
  const etag = object.httpEtag;
  const cases = [
    { name: "stale If-Range", headers: { Range: "bytes=0-1", "If-Range": '"stale"' }, status: 200, body },
    { name: "valid If-Range", headers: { Range: "bytes=0-1", "If-Range": etag }, status: 206, body: "01", range: "bytes 0-1/1000" },
    { name: "weak If-Range", headers: { Range: "bytes=0-1", "If-Range": `W/${etag}` }, status: 200, body },
    { name: "date If-Range", headers: { Range: "bytes=0-1", "If-Range": "Wed, 21 Oct 2015 07:28:00 GMT" }, status: 200, body },
    { name: "If-None-Match precedes range", headers: { Range: "bytes=0-1", "If-Range": '"stale"', "If-None-Match": etag }, status: 304, body: "" },
    { name: "weak validator list", headers: { Range: "bytes=0-1", "If-None-Match": `"other", W/${etag}` }, status: 304, body: "" },
    { name: "wildcard validator", headers: { "If-None-Match": "*" }, status: 304, body: "" },
    { name: "nonmatching conditional range", headers: { Range: "bytes=0-1", "If-None-Match": '"other"' }, status: 206, body: "01", range: "bytes 0-1/1000" },
    { name: "suffix", headers: { Range: "bytes=-3" }, status: 206, body: "789", range: "bytes 997-999/1000" },
    { name: "open end", headers: { Range: "bytes=998-" }, status: 206, body: "89", range: "bytes 998-999/1000" },
    { name: "clamped end", headers: { Range: "bytes=998-2000" }, status: 206, body: "89", range: "bytes 998-999/1000" },
    { name: "unsatisfiable", headers: { Range: "bytes=1000-", "If-Range": etag }, status: 416, body: "Range not satisfiable", range: "bytes */1000" },
    { name: "stale unsatisfiable", headers: { Range: "bytes=1000-", "If-Range": '"stale"' }, status: 200, body },
    { name: "multiple ranges ignored", headers: { Range: "bytes=0-1,4-5" }, status: 200, body },
    { name: "malformed range ignored", headers: { Range: "bytes=9-2" }, status: 200, body },
  ];

  for (const state of ["cold", "warm"]) {
    if (state === "warm") {
      const response = await mf.dispatchFetch(`https://media.test/${key}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), body);
      // Any subsequent success must come from the real cache, not R2 fallback.
      await bucket.delete(key);
    }
    for (const scenario of cases) {
      await t.test(`${state}: ${scenario.name}`, async () => {
        const response = await mf.dispatchFetch(`https://media.test/${key}`, { headers: scenario.headers });
        assert.deepEqual({ status: response.status, body: await response.text() }, {
          status: scenario.status,
          body: scenario.body,
        });
        assert.equal(response.headers.get("Content-Range"), scenario.range ?? null);
        assert.equal(response.headers.get("ETag"), etag);
        assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
        if (scenario.status === 416) {
          assert.equal(response.headers.get("Cache-Control"), "no-store");
          assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
        }
      });
    }
  }

  await t.test("HEAD ignores Range and describes the whole object", async () => {
    await bucket.put(key, body);
    for (const range of ["bytes=0-1", "bytes=1000-"]) {
      const response = await mf.dispatchFetch(`https://media.test/${key}`, { method: "HEAD", headers: { Range: range } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Length"), "1000");
      assert.equal(response.headers.get("Content-Range"), null);
    }
  });

  await t.test("warm: query string shares the cache entry", async () => {
    const response = await mf.dispatchFetch(`https://media.test/${key}?v=other`, { headers: { Range: "bytes=0-1" } });
    assert.deepEqual({ status: response.status, body: await response.text() }, { status: 206, body: "01" });
  });
});

test("a cached copy without a usable size falls back to R2", async (t) => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: "media",
      modules: true,
      script: outputFiles[0].text,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      r2Buckets: ["MEDIA_BUCKET"],
    }],
  }));
  t.after(() => mf.dispose());
  const bucket = await mf.getR2Bucket("MEDIA_BUCKET");
  const key = "trip-photos/sizeless";
  await bucket.put(key, body);
  const caches = await mf.getCaches();
  // A chunked body leaves the stored response without Content-Length.
  const chunked = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } });
  await caches.default.put(`https://media.test/${key}`, new Response(chunked, {
    headers: { "Cache-Control": "public, max-age=60", ETag: '"cached"' },
  }));
  const cached = await caches.default.match(`https://media.test/${key}`);
  assert.equal(cached?.headers.get("Content-Length") ?? null, null);
  await cached?.arrayBuffer();

  const response = await mf.dispatchFetch(`https://media.test/${key}`, { headers: { Range: "bytes=0-1" } });
  assert.deepEqual({ status: response.status, body: await response.text() }, { status: 206, body: "01" });
  assert.equal(response.headers.get("Content-Range"), "bytes 0-1/1000");
});
