export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

type ShareNavigator = {
  clipboard: { writeText: (text: string) => Promise<void> };
  share?: (data: ShareData) => Promise<void>;
};

export async function shareJourneyLink(
  navigatorLike: ShareNavigator,
  input: { title: string; text: string; url: string },
): Promise<ShareResult> {
  if (navigatorLike.share) {
    try {
      await navigatorLike.share(input);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }

  try {
    await navigatorLike.clipboard.writeText(input.url);
    return "copied";
  } catch {
    return "failed";
  }
}
