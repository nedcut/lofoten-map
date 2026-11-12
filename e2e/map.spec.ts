import { expect, test, type Page } from "./fixtures";

// The real map, in demo mode (three seeded photos, one per day). The other
// specs run without a Mapbox token, so everything that only exists on the map
// canvas (thumbnail markers, popups, placing things by clicking) is covered
// here and nowhere else. Runs only when a token is available; see
// playwright.config.ts.

const photoMarkers = (page: Page) => page.locator(".mapboxgl-marker");

async function openMap(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
}

test.describe("map", { tag: "@map" }, () => {
  test("shows a thumbnail for every photo once the opening flight settles", async ({ page }) => {
    await openMap(page);
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "View Reine harbor at golden hour" })).toBeVisible();
  });

  test("selecting a day leaves only that day's photos, and All days brings the rest back", async ({ page }) => {
    await openMap(page);
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 30_000 });
    await page.getByRole("button", { name: /Day 2: Kjerkfjorden hike/ }).first().click();
    await expect(photoMarkers(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "View Halfway up toward Kjerkfjorden" })).toBeVisible();
    await page.getByRole("button", { name: /All days/ }).first().click();
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 15_000 });
  });

  test("the photo layer toggle hides and restores the thumbnails", async ({ page }) => {
    await openMap(page);
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 30_000 });
    const toggle = page.getByRole("checkbox", { name: /Photos & videos/ });
    await toggle.uncheck({ force: true });
    await expect(photoMarkers(page)).toHaveCount(0);
    await toggle.check({ force: true });
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 15_000 });
  });

  test("a thumbnail opens its popup, and Relive from here starts Journey at that photo", async ({ page }) => {
    await openMap(page, "/?day=1");
    await page.getByRole("button", { name: "View Reine harbor at golden hour" }).click({ timeout: 30_000 });
    const popup = page.locator(".mapboxgl-popup");
    await expect(popup).toContainText("Reine harbor at golden hour");
    await popup.getByRole("button", { name: "Relive from here" }).click();
    await expect(page.getByRole("dialog", { name: "Journey Mode" })).toBeVisible();
    await expect(page).toHaveURL(/journey=photo%3Aphoto-demo-1/);
  });

  // The main map is display:none while Journey is open and has to resize and
  // rebuild its markers on the way back.
  test("thumbnails return after Journey closes", async ({ page }) => {
    await openMap(page);
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 30_000 });
    await page.getByRole("button", { name: /^Relive the journey/ }).first().click();
    await page.getByRole("button", { name: "Begin journey" }).click();
    await expect(page.getByRole("img", { name: "Reine harbor at golden hour" })).toBeVisible();
    await page.getByRole("button", { name: "Close journey" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 15_000 });
  });

  // Autoplay opens each day on a title card with the mini-map full-screen
  // behind it. The press that dismisses the card must still reach the control
  // under it; the map used to rise over the header mid-click and swallow it.
  test("Close works while a day's title card is showing", async ({ page }) => {
    await openMap(page);
    await page.getByRole("button", { name: /^Relive the journey/ }).first().click();
    await page.getByRole("button", { name: "Begin journey" }).click();
    await expect(page.locator(".journey-chapter-in")).toContainText("Reine arrival");
    await page.getByRole("button", { name: "Close journey" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/journey=/);
  });

  test("a note is placed by clicking the map and shows up in the sidebar", async ({ page }) => {
    await openMap(page);
    await expect(photoMarkers(page)).toHaveCount(3, { timeout: 30_000 });
    await page.getByRole("button", { name: "Add to the logbook" }).click();
    await page.getByRole("menuitem", { name: /Add note/ }).click();
    const panel = page.getByRole("dialog", { name: "Add a trail note" });
    await expect(panel.getByRole("status")).toHaveText("No coordinate yet. Click or tap the map.");
    // Open water south of the islands: clear of the sidebar on the left, the
    // note panel on the right, and every marker.
    await page.mouse.click(600, 640);
    await expect(panel.getByRole("status")).toHaveText(/^\d+\.\d+, \d+\.\d+$/);
    await panel.getByRole("textbox", { name: "Note" }).fill("Wind picked up on the ridge");
    await panel.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByRole("button", { name: /^note Wind picked up on the ridge/ })).toBeVisible();
  });
});
