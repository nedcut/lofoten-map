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
