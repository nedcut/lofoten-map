import { expect, test, type Page } from "@playwright/test";

// Journey Mode entry, exit, and navigation in demo mode (three seeded days).

async function openIntro(page: Page) {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Relive the journey", exact: true });
  await opener.click();
  await expect(page.getByText("A shared travel story")).toBeVisible();
  return opener;
}

async function expectClosedWithoutPlaying(page: Page) {
  await expect(page.getByText("A shared travel story")).toBeHidden();
  await expect(page.getByText("Journey Mode")).toBeHidden();
  await expect(page).not.toHaveURL(/journey=/);
}

test.describe("journey introduction exits", { tag: ["@desktop", "@mobile"] }, () => {
  test("Close in the introduction returns to the map and refocuses the opener", async ({ page }) => {
    const opener = await openIntro(page);
    await page.getByRole("dialog").getByRole("button", { name: "Close journey" }).click();
    await expectClosedWithoutPlaying(page);
    await expect(opener).toBeFocused();
  });

  test("Return to map leaves without starting playback", async ({ page }) => {
    await openIntro(page);
    await page.getByRole("button", { name: "Return to map" }).click();
    await expectClosedWithoutPlaying(page);
  });

  test("Escape and browser Back both leave the introduction", async ({ page }) => {
    const opener = await openIntro(page);
    await page.keyboard.press("Escape");
    await expectClosedWithoutPlaying(page);
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(page.getByText("A shared travel story")).toBeVisible();
    await page.goBack();
    await expectClosedWithoutPlaying(page);
  });

  test("Tab stays inside the introduction", async ({ page }) => {
    await openIntro(page);
    const intro = page.getByRole("dialog");
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      expect(await intro.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
  });
});

test.describe("journey day navigation", { tag: ["@desktop", "@mobile"] }, () => {
  test("the day picker jumps to each day's first moment and timeline dots are not tap targets", async ({ page }) => {
    await page.goto("/?journey=photo%3Aphoto-demo-1");
    const picker = page.getByRole("combobox", { name: "Jump to day" });
    const box = await picker.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('button[aria-label^="Jump to"]')).toHaveCount(0);

    await picker.selectOption({ label: "Day 3: Moskenes coast" });
    await expect(page.getByRole("dialog", { name: "Journey Mode" }).getByText("Day 3: Moskenes coast", { exact: true }).filter({ visible: true })).toBeVisible();
    const slider = page.getByRole("slider", { name: "Journey progress" });
    const day3Index = await slider.inputValue();

    await picker.selectOption({ label: "Day 1: Reine arrival" });
    await expect(slider).toHaveValue("0");
    await picker.selectOption({ label: "Day 3: Moskenes coast" });
    await expect(slider).toHaveValue(day3Index);
  });
});

test.describe("journey mini-map toggle", { tag: "@mobile" }, () => {
  test("Map hides and restores the mini-map, remembered for the session", async ({ page }) => {
    await page.goto("/?journey=photo%3Aphoto-demo-1");
    const toggle = page.getByRole("button", { name: "Map", exact: true });
    const miniMap = page.locator("[data-journey-minimap]");
    const initiallyShown = (await toggle.getAttribute("aria-pressed")) === "true";
    await expect(miniMap).toHaveCount(initiallyShown ? 1 : 0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", String(!initiallyShown));
    await expect(miniMap).toHaveCount(initiallyShown ? 0 : 1);

    await page.reload();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", String(!initiallyShown));
  });
});

test.describe("journey entry labels", { tag: "@desktop" }, () => {
  test("a selected day offers to start the journey there, not a day-only replay", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Day 1: Reine arrival/ }).first().click();
    await expect(page.getByRole("button", { name: /^Start journey at Day 1 — / })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start journey at Day 2", exact: true })).toBeVisible();
    await expect(page.getByText(/Relive Day/)).toHaveCount(0);
  });
});
