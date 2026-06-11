import { expect, test } from "@playwright/test";

// All specs run against demo mode (bundled sample data, no Supabase), so they
// assert on the app shell and day filtering rather than live data. Map-canvas
// behavior is deliberately untested here: CI has no Mapbox token, where the
// app shows its token-missing fallback instead of tiles.

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "desktop sidebar is hidden on mobile");

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
    if (await page.getByRole("heading", { name: "Mapbox token needed" }).isVisible()) {
      test.skip(true, "no Mapbox token; map actions are disabled");
    }
    await page.getByRole("button", { name: "Upload media" }).first().click();
    // 1x1 PNG; no GPS, so the item parks at needs-location and is persistable.
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator("input[type=file]").first().setInputFiles({ name: "draft-photo.png", mimeType: "image/png", buffer: pixel });
    await expect(page.getByText("Tap map to place").first()).toBeVisible();
    // Wait past the debounced IndexedDB write, then simulate a lost session.
    await page.waitForTimeout(1200);
    await page.reload();
    await page.getByRole("button", { name: "Upload media" }).first().click();
    await expect(page.getByText("Unfinished import found")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Unfinished import found")).toBeHidden();
  });

  test("photo marker opens a popup with the demo photo", async ({ page }) => {
    await page.goto("/");
    // Without a Mapbox token (CI) the map shows its fallback and there are
    // no markers to test — only run where tiles actually render.
    if (await page.getByRole("heading", { name: "Mapbox token needed" }).isVisible()) {
      test.skip(true, "no Mapbox token; map fallback is shown");
    }
    // Filter to day 1 so its single photo cannot be clustered away.
    await page.getByRole("button", { name: /Day 1: Reine arrival/ }).click();
    const marker = page.getByRole("button", { name: "View Reine harbor at golden hour" });
    await expect(marker).toBeVisible({ timeout: 15_000 });
    await marker.click();
    await expect(page.locator(".mapboxgl-popup")).toContainText("Reine harbor at golden hour");
  });
});

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile sheet only renders on small viewports");

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
