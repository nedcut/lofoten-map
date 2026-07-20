const PUBLIC_NAMESPACES = ["trip-photos/", "avatars/"] as const;

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = responseHeaders();
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return new Response("Method not allowed", { status: 405, headers });
    }

    const key = objectKey(request);
    if (!key) return new Response("Not found", { status: 404, headers });

    try {
      if (request.method === "HEAD") {
        const object = await env.MEDIA_BUCKET.head(key);
        if (!object) return new Response("Not found", { status: 404, headers });
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(null, { status: 200, headers });
      }

      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) return new Response("Not found", { status: 404, headers });
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(object.body, { status: 200, headers });
    } catch (error) {
      console.error(JSON.stringify({
        message: "R2 media request failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return new Response("Internal server error", { status: 500, headers });
    }
  },
} satisfies ExportedHandler<Env>;
