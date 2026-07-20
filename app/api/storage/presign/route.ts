import { NextResponse } from "next/server";
import { authorizeObjectRequest, parseNamespace, presignPut, validObjectPath } from "@/lib/object-store-server";

const ALLOWED_CONTENT_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime))$/i;
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  try {
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
    const message = error instanceof Error ? error.message : "Could not prepare upload.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
