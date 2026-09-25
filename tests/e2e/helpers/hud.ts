import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Reads a HUD `<dt>/<dd>` pair by definition term label. */
export function hudValue(page: Page, label: string): Locator {
  return page
    .locator("dl div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
}

export async function expectHud(page: Page, label: string, value: string | RegExp): Promise<void> {
  await expect(hudValue(page, label)).toHaveText(value);
}

export function attachPageErrorCapture(page: Page): {
  assertClean: () => void;
} {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  return {
    assertClean() {
      expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
      expect(consoleErrors, `console error: ${consoleErrors.join(" | ")}`).toEqual([]);
    },
  };
}
