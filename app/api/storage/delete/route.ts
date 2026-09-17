import { NextResponse } from "next/server";
import { authorizeObjectRequest, parseNamespace, removeObjects, validObjectPath } from "@/lib/object-store-server";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const namespace = parseNamespace(body.namespace);
    const paths = body.paths;
    if (!namespace || !Array.isArray(paths) || paths.length === 0 || paths.length > 100 || !paths.every(validObjectPath)) {
      return NextResponse.json({ error: "Invalid storage delete request." }, { status: 400 });
    }
    const authorized = await Promise.all(paths.map((path) => authorizeObjectRequest(request, namespace, path, "delete")));
    if (authorized.some((allowed) => !allowed)) {
      return NextResponse.json({ error: "You do not have permission to delete these objects." }, { status: 403 });
    }
    await removeObjects(namespace, paths);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // S3 client errors can name the bucket, endpoint, or other keys. Keep the
    // detail in the server log and return a generic message to the caller.
    console.error("[storage/delete]", error);
    return NextResponse.json({ error: "Could not delete objects." }, { status: 500 });
  }
}
