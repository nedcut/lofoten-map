import "server-only";

import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AVATAR_BUCKET, PHOTO_BUCKET, type ObjectNamespace } from "@/lib/object-store";
import { isMissingSchemaObjectError } from "@/lib/schema-errors";

const NAMESPACES = new Set<ObjectNamespace>([PHOTO_BUCKET, AVATAR_BUCKET]);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function r2Client() {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export function parseNamespace(value: unknown): ObjectNamespace | null {
  return typeof value === "string" && NAMESPACES.has(value as ObjectNamespace) ? value as ObjectNamespace : null;
}

export function validObjectPath(path: unknown): path is string {
  return typeof path === "string"
    && path.length > 0
    && path.length <= 1024
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.includes("\0")
    && path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function objectKey(namespace: ObjectNamespace, path: string) {
  return `${namespace}/${path}`;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

async function rpc(token: string, functionName: string, body: Record<string, unknown>): Promise<unknown> {
  const baseUrl = requiredEnv("NEXT_PUBLIC_NEON_DATA_API_URL").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rpc/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    // A function the schema does not have yet (PostgREST PGRST202) is a
    // deployment mistake, not a permission decision. Surface it so the route
    // can report the missing patch instead of a misleading 403.
    const failure = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    if (typeof failure?.message === "string" && isMissingSchemaObjectError({ code: failure.code, message: failure.message }, functionName)) {
      throw new Error(`Database RPC ${functionName} is missing: ${failure.message}`);
    }
    return null;
  }
  return response.json();
}

// New photo uploads are content-addressed by lib/photo-upload.ts:
//   <trip-slug>/<sha256 hex>.<ext>        original
//   <trip-slug>/thumbs/<sha256 hex>.jpg   thumbnail
// Presigning only these shapes keeps a member from parking arbitrary keys in
// the trip's namespace. Legacy UUID keys still exist for old rows, but they
// are only ever deleted, never re-uploaded, so they are not matched here.
const CONTENT_ADDRESSED_PHOTO_PATH = /^[^/]+\/(thumbs\/[0-9a-f]{64}\.jpg|[0-9a-f]{64}\.[a-z0-9]{1,8})$/;

export function isContentAddressedPhotoPath(path: string): boolean {
  return CONTENT_ADDRESSED_PHOTO_PATH.test(path);
}

export async function authorizeObjectRequest(
  request: Request,
  namespace: ObjectNamespace,
  path: string,
  operation: "upload" | "delete",
): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;
  const ownerSegment = path.split("/", 1)[0];

  if (namespace === PHOTO_BUCKET) {
    if (operation === "upload") {
      if (!isContentAddressedPhotoPath(path)) return false;
      return await rpc(token, "is_trip_member_by_slug", { check_trip_slug: ownerSegment }) === true;
    }
    // Deletion is bound to the photo rows, not just trip membership, so a
    // member cannot remove another member's files through this route. The RPC
    // mirrors the photos DELETE policy; see neon/schema.sql.
    return await rpc(token, "can_delete_photo_object", { check_trip_slug: ownerSegment, check_path: path }) === true;
  }

  if (await rpc(token, "current_user_id", {}) === ownerSegment) return true;
  // Migrated avatars may still be stored below the old Supabase UUID. Only an
  // exact match to this user's current membership avatar is deletable; a user
  // must never gain arbitrary delete access to someone else's legacy prefix.
  return operation === "delete" && await rpc(token, "is_my_avatar_path", { check_path: path }) === true;
}

export async function presignPut(input: {
  namespace: ObjectNamespace;
  path: string;
  contentType: string;
  cacheControl: string;
  contentLength: number;
}) {
  const cacheControl = `public, max-age=${input.cacheControl}, immutable`;
  return getSignedUrl(
    r2Client(),
    new PutObjectCommand({
      Bucket: requiredEnv("R2_BUCKET_NAME"),
      Key: objectKey(input.namespace, input.path),
      ContentType: input.contentType,
      CacheControl: cacheControl,
      ContentLength: input.contentLength,
      IfNoneMatch: "*",
    }),
    { expiresIn: 300 },
  );
}

export async function removeObjects(namespace: ObjectNamespace, paths: string[]) {
  const result = await r2Client().send(new DeleteObjectsCommand({
    Bucket: requiredEnv("R2_BUCKET_NAME"),
    Delete: { Objects: paths.map((path) => ({ Key: objectKey(namespace, path) })), Quiet: true },
  }));
  if (result.Errors?.length) throw new Error(result.Errors.map((error) => `${error.Key}: ${error.Message ?? error.Code}`).join("; "));
}
