import { expect, test } from "@playwright/test";

// All specs run against demo mode (bundled sample data, no Supabase), so they
// assert on the app shell and data flows rather than live Supabase data.
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
    await page.getByRole("button", { name: /Day 2: Kjerkfjorden hike/ }).click();
    await expect(page).toHaveURL(/day=/);

    // A reload of the shared URL must restore the same selection.
    await page.reload();
    await expect(page.getByRole("button", { name: /Day 2: Kjerkfjorden hike/ })).toBeVisible();
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
    await page.getByRole("button", { name: "Open Journey Mode" }).click();
    await expect(page.getByText("Reine harbor at golden hour")).toBeVisible();
    await expect(page.getByRole("img", { name: "Reine harbor at golden hour" })).toBeVisible();
    const uploaderFilter = page.getByRole("combobox", { name: "Filter journey by uploader" });
    await expect(uploaderFilter.getByRole("option", { name: "Maja" })).toHaveAttribute("value", "person-1");
    await uploaderFilter.selectOption({ label: "Maja" });
    await expect(page.getByText("Reine harbor at golden hour")).toBeVisible();
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
