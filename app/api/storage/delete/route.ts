import { NextResponse } from "next/server";
import { authorizeObjectRequest, parseNamespace, removeObjects, validObjectPath } from "@/lib/object-store-server";
import { isMissingSchemaObjectError } from "@/lib/schema-errors";
import { isPreviewReadOnly, PREVIEW_READ_ONLY_MESSAGE } from "@/lib/preview-read-only";

const DELETE_RPC = "can_delete_photo_object";
const DELETE_RPC_PATCH = "neon/patches/2026-09-07-can-delete-photo-object.sql";

export async function POST(request: Request) {
  try {
    if (isPreviewReadOnly()) {
      return NextResponse.json({ error: PREVIEW_READ_ONLY_MESSAGE }, { status: 403 });
    }
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
    if (error instanceof Error && isMissingSchemaObjectError(error, DELETE_RPC)) {
      console.error(`[storage/delete] The ${DELETE_RPC} RPC does not exist in the database. Apply ${DELETE_RPC_PATCH}.`, error);
      return NextResponse.json(
        { error: `The database is missing the ${DELETE_RPC} function. Apply ${DELETE_RPC_PATCH} before using this route.` },
        { status: 500 },
      );
    }
    // S3 client errors can name the bucket, endpoint, or other keys. Keep the
    // detail in the server log and return a generic message to the caller.
    console.error("[storage/delete]", error);
    return NextResponse.json({ error: "Could not delete objects." }, { status: 500 });
  }
}
