import { expect, test as base } from "@playwright/test";

// Every spec imports `test` from here, so a run fails on any uncaught
// exception or console error even when the assertions it wrote still pass.
// That is the class of regression a human notices at once in devtools and an
// assertion-only suite never sees.

// Vercel's analytics scripts only exist on a Vercel deployment; locally the
// browser logs errors naming their URL, in the message or as its source.
const VERCEL_ANALYTICS = /\/_vercel\/(insights|speed-insights)\//;

export const test = base.extend<{ failOnBrowserErrors: void }>({
  failOnBrowserErrors: [async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const source = message.location().url;
      if (VERCEL_ANALYTICS.test(source) || VERCEL_ANALYTICS.test(message.text())) return;
      problems.push(`console.error: ${message.text()} (${source})`);
    });
    await use();
    expect(problems, "the page logged errors during this test").toEqual([]);
  }, { auto: true }],
});

export { expect };
export type { Page } from "@playwright/test";
