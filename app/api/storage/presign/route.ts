import { NextResponse } from "next/server";
import { authorizeObjectRequest, parseNamespace, presignPut, validObjectPath } from "@/lib/object-store-server";
import { isPreviewReadOnly, PREVIEW_READ_ONLY_MESSAGE } from "@/lib/preview-read-only";

const ALLOWED_CONTENT_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime))$/i;
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

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
    if (!namespace
      || !validObjectPath(path)
      || typeof contentType !== "string"
      || !ALLOWED_CONTENT_TYPES.test(contentType)
      || typeof contentLength !== "number"
      || !Number.isInteger(contentLength)
      || contentLength <= 0
      || contentLength > MAX_OBJECT_BYTES) {
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
