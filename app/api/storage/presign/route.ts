import { NextResponse } from "next/server";
import { maxUploadBytesFor } from "@/lib/media-formats";
import { authorizeObjectRequest, parseNamespace, presignPut, validObjectPath } from "@/lib/object-store-server";
import { isPreviewReadOnly, PREVIEW_READ_ONLY_MESSAGE } from "@/lib/preview-read-only";

export async function POST(request: Request) {
  try {
    if (isPreviewReadOnly()) {
      return NextResponse.json({ error: PREVIEW_READ_ONLY_MESSAGE }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const namespace = parseNamespace(body.namespace);
    const path = body.path;
    const contentType = body.contentType;
    const cacheControl = body.cacheControl;
    const contentLength = body.contentLength;
    // Same allowlist and per-type caps the upload picker enforces, narrowed to
    // what the app writes at this path.
    const maxBytes = namespace && validObjectPath(path) && typeof contentType === "string"
      ? maxUploadBytesFor(namespace, path, contentType)
      : null;
    if (!namespace
      || !validObjectPath(path)
      || typeof contentType !== "string"
      || maxBytes === null
      || typeof contentLength !== "number"
      || !Number.isInteger(contentLength)
      || contentLength <= 0
      || contentLength > maxBytes) {
      return NextResponse.json({ error: "Invalid storage upload request." }, { status: 400 });
    }
    if (cacheControl !== "31536000") {
      return NextResponse.json({ error: "Invalid cache policy." }, { status: 400 });
    }
    if (!await authorizeObjectRequest(request, namespace, path, "upload")) {
      return NextResponse.json({ error: "You do not have permission to upload this object." }, { status: 403 });
    }
    return NextResponse.json({ url: await presignPut({ namespace, path, contentType, cacheControl, contentLength }) });
  } catch (error) {
    // S3 client errors can name the bucket, endpoint, or other keys. Keep the
    // detail in the server log and return a generic message to the caller.
    console.error("[storage/presign]", error);
    return NextResponse.json({ error: "Could not prepare upload." }, { status: 500 });
  }
}
