const PUBLIC_NAMESPACES = ["trip-photos/", "avatars/"] as const;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
// Keys are content-addressed or random and uploads refuse overwrites, so an
// object never changes. It can still be deleted, so the edge copy expires after
// a day instead of a year. Browsers ignore s-maxage.
const EDGE_CACHE_SECONDS = 86400;

type ByteRange = { offset: number; length: number };

function responseHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
  });
}

function objectKey(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (!PUBLIC_NAMESPACES.some((namespace) => key.startsWith(namespace))) return null;
  if (key.includes("\\") || key.includes("\0") || key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return key;
}

function writeObjectHeaders(headers: Headers, object: R2Object) {
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
}

function stripWeak(etag: string) {
  return etag.startsWith("W/") ? etag.slice(2) : etag;
}

function matchesIfNoneMatch(request: Request, etag: string) {
  const header = request.headers.get("If-None-Match");
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((candidate) => stripWeak(candidate.trim()) === stripWeak(etag));
}

/**
 * Parses a single-range `bytes=` header against the object size.
 * Returns null when the header should be ignored (absent, malformed, multiple
 * ranges, or a stale If-Range) and "unsatisfiable" when it asks for no bytes
 * that exist, per RFC 9110 section 14.
 */
function parseRange(request: Request, size: number, etag: string): ByteRange | "unsatisfiable" | null {
  const header = request.headers.get("Range");
  if (!header) return null;
  const ifRange = request.headers.get("If-Range");
  if (ifRange && ifRange.trim() !== etag) return null;

  const match = /^bytes=\s*(\d*)-(\d*)\s*$/.exec(header);
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    const suffix = Number(endText);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const start = Number(startText);
  const end = endText === "" ? Infinity : Number(endText);
  if (end < start) return null;
  if (start >= size) return "unsatisfiable";
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

// Built from scratch so a 416 never inherits the object's year-long cache
// policy or its media Content-Type.
function rangeNotSatisfiable(etag: string, size: number) {
  const headers = responseHeaders();
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("ETag", etag);
  headers.set("Content-Range", `bytes */${size}`);
  return new Response("Range not satisfiable", { status: 416, headers });
}

function edgeCacheCopy(response: Response) {
  const copy = new Response(response.clone().body, response);
  copy.headers.set("Cache-Control", `${copy.headers.get("Cache-Control")}, s-maxage=${EDGE_CACHE_SECONDS}`);
  return copy;
}

async function serveObject(request: Request, env: Env, ctx: ExecutionContext, key: string, headers: Headers) {
  const isGet = request.method === "GET";
  const cache = caches.default;
  // The query string never selects a different object, so leave it out of the
  // key; otherwise any ?suffix forces a miss and another R2 read.
  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  // Evaluate validators and ranges just as on an R2 miss. Cache.match applies
  // Range but ignores If-Range, so never pass the original headers through.
  if (isGet) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const etag = cached.headers.get("ETag") ?? "";
      if (matchesIfNoneMatch(request, etag)) {
        void cached.body?.cancel();
        const headers = new Headers(cached.headers);
        headers.delete("Content-Length");
        return new Response(null, { status: 304, headers });
      }
      // Ranges are resolved against the cached size; without a usable one,
      // fall through to R2 rather than answer from a guess.
      const length = cached.headers.get("Content-Length") ?? "";
      const range = /^\d+$/.test(length) ? parseRange(request, Number(length), etag) : undefined;
      if (range === null) return cached;
      void cached.body?.cancel();
      if (range === "unsatisfiable") return rangeNotSatisfiable(etag, Number(length));
      if (range) {
        const partial = await cache.match(new Request(cacheKey, {
          headers: { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` },
        }));
        if (partial) return partial;
      }
    }
  }

  const wantsPartialOrConditional = request.headers.has("Range") || request.headers.has("If-None-Match");
  if (isGet && !wantsPartialOrConditional) {
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) return new Response("Not found", { status: 404, headers });
    writeObjectHeaders(headers, object);
    headers.set("Content-Length", String(object.size));
    const response = new Response(object.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, edgeCacheCopy(response)).catch((error: unknown) => {
      console.error(JSON.stringify({
        message: "R2 media cache write failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
    }));
    return response;
  }

  // HEAD, Range, and conditional requests read metadata first so a 304, 416, or
  // HEAD never pays for the object body.
  const metadata = await env.MEDIA_BUCKET.head(key);
  if (!metadata) return new Response("Not found", { status: 404, headers });
  writeObjectHeaders(headers, metadata);

  if (matchesIfNoneMatch(request, metadata.httpEtag)) return new Response(null, { status: 304, headers });

  // Range applies only to GET (RFC 9110 section 14.2); HEAD describes the
  // whole object.
  const range = isGet ? parseRange(request, metadata.size, metadata.httpEtag) : null;
  if (range === "unsatisfiable") return rangeNotSatisfiable(metadata.httpEtag, metadata.size);

  if (!range) {
    headers.set("Content-Length", String(metadata.size));
    if (!isGet) return new Response(null, { status: 200, headers });
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) return new Response("Not found", { status: 404, headers: responseHeaders() });
    return new Response(object.body, { status: 200, headers });
  }

  headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
  headers.set("Content-Length", String(range.length));
  const object = await env.MEDIA_BUCKET.get(key, { range });
  if (!object) return new Response("Not found", { status: 404, headers: responseHeaders() });
  return new Response(object.body, { status: 206, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const headers = responseHeaders();
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return new Response("Method not allowed", { status: 405, headers });
    }

    const key = objectKey(request);
    if (!key) return new Response("Not found", { status: 404, headers });

    try {
      return await serveObject(request, env, ctx, key, headers);
    } catch (error) {
      console.error(JSON.stringify({
        message: "R2 media request failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return new Response("Internal server error", { status: 500, headers: responseHeaders() });
    }
  },
} satisfies ExportedHandler<Env>;
