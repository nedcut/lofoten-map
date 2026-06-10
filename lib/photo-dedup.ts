import type { Photo } from "@/types/trip";

export type PhotoDedupCandidate = {
  contentHash: string;
  mediaType?: "photo" | "video";
  takenAt: string | null | undefined;
  coordinate: { lat: number; lng: number };
};

/**
 * Stable fingerprint of when and where a photo was taken. Hash-based dedup
 * misses re-uploads of photos we stored re-encoded (the original bytes are
 * gone, so the hashes never match) — but EXIF capture time plus GPS survives
 * re-encoding. Null when either part is missing, so hand-placed photos with
 * no capture time can never collide.
 */
export function photoMetadataKey(takenAt: string | null | undefined, lat: number | null, lng: number | null): string | null {
  if (!takenAt || lat === null || lng === null) return null;
  const time = Date.parse(takenAt);
  if (Number.isNaN(time)) return null;
  return `${time}|${lat.toFixed(6)}|${lng.toFixed(6)}`;
}

/**
 * Split upload candidates into fresh uploads and duplicates of either an
 * existing photo or an earlier candidate in the same batch. A candidate is a
 * duplicate when its content hash matches, or when its capture-time/GPS
 * fingerprint matches (see photoMetadataKey).
 */
export function partitionDuplicatePhotos<T extends PhotoDedupCandidate>(candidates: T[], existing: Photo[]): { uploads: T[]; duplicates: T[] } {
  const seenHashes = new Set(existing.map((photo) => photo.content_hash).filter((hash): hash is string => Boolean(hash)));
  const seenMeta = new Set(existing.map((photo) => {
    const key = photoMetadataKey(photo.taken_at, photo.lat, photo.lng);
    return key ? `${photo.media_type ?? "photo"}|${key}` : null;
  }).filter((key): key is string => Boolean(key)));
  const uploads: T[] = [];
  const duplicates: T[] = [];
  for (const candidate of candidates) {
    const metadata = photoMetadataKey(candidate.takenAt, candidate.coordinate.lat, candidate.coordinate.lng);
    const metaKey = metadata ? `${candidate.mediaType ?? "photo"}|${metadata}` : null;
    if (seenHashes.has(candidate.contentHash) || (metaKey !== null && seenMeta.has(metaKey))) {
      duplicates.push(candidate);
      continue;
    }
    seenHashes.add(candidate.contentHash);
    if (metaKey !== null) seenMeta.add(metaKey);
    uploads.push(candidate);
  }
  return { uploads, duplicates };
}
