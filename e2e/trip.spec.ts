import { expect, test } from "@playwright/test";

// All specs run against demo mode (bundled sample data, no Neon or R2), so they
// assert on the app shell and data flows rather than live backend data.
// Map-canvas behavior is deliberately out of scope because CI has no token.

test.describe("desktop", { tag: "@desktop" }, () => {
  test("loads the trip shell with demo days", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Lofoten 2026" })).toBeVisible();
    await expect(page.getByRole("button", { name: /All days/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Day 1: Reine arrival/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Day 3: Moskenes coast/ })).toBeVisible();
  });

  test("selecting a day filters and round-trips through the URL", async ({ page }) => {
    await page.goto("/");
    const dayTwo = page.getByRole("button", { name: /Day 2: Kjerkfjorden hike/ }).first();
    const allDays = page.getByRole("button", { name: /All days/ }).first();
    await dayTwo.click();
    await expect(page).toHaveURL(/day=/);
    await expect(dayTwo).toHaveAttribute("aria-pressed", "true");
    await expect(allDays).toHaveAttribute("aria-pressed", "false");

    // A reload of the shared URL must restore the same selection.
    await page.reload();
    await expect(page.getByRole("button", { name: /Day 2: Kjerkfjorden hike/ }).first()).toHaveAttribute("aria-pressed", "true");
  });

  test("day stepper walks from All days into day 1", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Next day" }).first().click();
    await expect(page).toHaveURL(/day=/);
  });

  test("photo import queue survives a reload as a restorable draft", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Mapbox token needed" })).toBeVisible();
    // Opening the panel auto-clicks the hidden input in a useEffect, but
    // mapless mode intentionally leaves the visible chooser card in place.
    await page.getByRole("button", { name: "Upload media" }).first().click();
    // 1x1 PNG; no GPS, so the item parks at needs-location and is persistable.
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator('input[name="media"][type="file"]').setInputFiles({ name: "draft-photo.png", mimeType: "image/png", buffer: pixel });
    await expect(page.getByText("The map is unavailable. Unplaced media is saved on this device and can be finished later.").first()).toBeVisible();
    // Wait for the debounced IndexedDB write itself rather than guessing how
    // long it will take under parallel CI load.
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("lofoten-logbook-drafts", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = db.transaction("photo-queues", "readonly").objectStore("photo-queues").get("lofoten-2026");
          request.onsuccess = () => resolve(request.result?.items?.length ?? 0);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    })).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Upload media" }).first().click();
    await expect(page.getByText("Unfinished import found")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Unfinished import found")).toBeHidden();
  });

  test("journey mode renders the seeded demo photo pipeline", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Day 1: Reine arrival/ }).click();
    await page.getByRole("button", { name: "Relive the journey" }).first().click();
    await expect(page.getByText("Reine harbor at golden hour")).toBeVisible();
    await expect(page.getByRole("img", { name: "Reine harbor at golden hour" })).toBeVisible();
    const uploaderFilter = page.getByRole("combobox", { name: "Filter journey by uploader" });
    await expect(uploaderFilter.getByRole("option", { name: "Maja" })).toHaveAttribute("value", "person-1");
    await uploaderFilter.selectOption({ label: "Maja" });
    await expect(page.getByText("Reine harbor at golden hour")).toBeVisible();
  });

  test("global journey entry opens with an authored introduction and deep links restore the exact moment", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Relive the journey" }).first().click();
    await expect(page.getByRole("heading", { name: "Lofoten 2026" })).toBeVisible();
    await expect(page.getByText("A shared travel story")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("button", { name: "Begin journey" })).toBeFocused();
    await page.getByRole("button", { name: "Begin journey" }).click();
    await expect(page.getByRole("img", { name: "Reine harbor at golden hour" })).toBeVisible();
    await expect(page).toHaveURL(/journey=photo%3Aphoto-demo-1/);

    await page.reload();
    await expect(page.getByRole("img", { name: "Reine harbor at golden hour" })).toBeVisible();
    await expect(page.getByText("A shared travel story")).toBeHidden();
  });

  test("journey share confirms the exact deep link was shared", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/?journey=photo%3Aphoto-demo-1");
    await page.getByRole("button", { name: "Share journey" }).click();
    await expect(page.getByRole("status")).toContainText(/Link copied|Journey shared/);
  });

  test("browser Back exits a Journey opened from the map", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Day 1: Reine arrival/ }).click();
    await page.getByRole("button", { name: "Relive the journey" }).first().click();
    await expect(page.getByText("Journey Mode")).toBeVisible();
    await page.goBack();
    await expect(page.getByText("Journey Mode")).toBeHidden();
    await expect(page).not.toHaveURL(/journey=/);
  });

  test("autoplay finishes with a deliberate ending and can replay", async ({ page }) => {
    await page.goto("/?journey=photo%3Aphoto-demo-1");
    const progress = page.getByRole("slider", { name: "Journey progress" });
    const last = await progress.getAttribute("max");
    await progress.fill(last ?? "0");
    await page.getByRole("button", { name: "Start autoplay" }).click();
    await expect(page.getByText("End of the journey")).toBeVisible({ timeout: 12_000 });
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByText("End of the journey")).toBeHidden();
    await expect(page.getByRole("img", { name: "Reine harbor at golden hour" })).toBeVisible();
  });
});

test.describe("mobile", { tag: "@mobile" }, () => {
  test("shows the bottom sheet instead of the sidebar", async ({ page }) => {
    await page.goto("/");
    // The desktop sidebar is also in the DOM (just display:none), so match
    // only what's actually rendered on a small viewport.
    await expect(page.getByText("All days").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lofoten 2026" })).toBeHidden();
  });

  test("steps days from the sheet header", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Next day" }).first().click();
    await expect(page).toHaveURL(/day=/);
    await expect(page.getByText("Day 1: Reine arrival").filter({ visible: true })).toBeVisible();
  });
});
