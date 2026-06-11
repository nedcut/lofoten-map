// Bylines and filters render uploader/author names that may be raw email
// addresses (older photo rows stored the signed-in email when no display name
// was set, and reads are public). This formats those into a friendly name at
// render time so guests never see a member's email.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns a person name safe to show publicly. Non-email values pass through
 * trimmed; emails collapse to their prettified local part, e.g.
 * "ned.cutler@gmail.com" -> "Ned Cutler". Returns null for empty input so
 * callers can fall back the same way they would for a missing name.
 */
export function friendlyPersonName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!EMAIL_PATTERN.test(trimmed)) return trimmed;
  const words = trimmed
    .slice(0, trimmed.indexOf("@"))
    .split(/[._\-+]+/)
    .filter(Boolean);
  if (words.length === 0) return "Friend";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
