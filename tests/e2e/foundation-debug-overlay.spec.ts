import { expect, test, type Page } from "@playwright/test";
import { attachPageErrorCapture, expectHud } from "./helpers/hud.js";

/** Reads a debug-overlay `<dt>/<dd>` pair. Kept separate from the lobby HUD. */
function debugValue(page: Page, label: string) {
  return page
    .locator(".debug-overlay dl div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
}

/**
 * F10: development overlay after a real create/start.
 * Avoids exact FPS and exact RTT assertions.
 */
test.describe("F10 debug overlay", () => {
  test("shows live metrics and opens the Inspector hook", async ({ page }) => {
    const errors = attachPageErrorCapture(page);

    await page.goto("/");
    await expect(page.getByTestId("debug-overlay")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();

    await page.getByRole("button", { name: "Create room" }).click();
    await expectHud(page, "Status", "connected");
    await page.getByRole("button", { name: "Start" }).click();
    await expectHud(page, "Phase", "RUNNING");

    await expect(debugValue(page, "Entities")).toHaveText("8");

    const readTick = async (): Promise<number> =>
      Number((await debugValue(page, "Server tick").textContent())?.trim());
    const tickBefore = await readTick();
    await expect.poll(readTick).toBeGreaterThan(tickBefore);

    await expect
      .poll(async () => Number((await debugValue(page, "FPS").textContent())?.trim()))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Number((await debugValue(page, "Draw calls").textContent())?.trim()))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Number((await debugValue(page, "Active meshes").textContent())?.trim()))
      .toBeGreaterThan(0);
    await expect(debugValue(page, "Frame ms")).toHaveText(/^\d+\.\d$/);

    await expect
      .poll(async () => (await debugValue(page, "RTT").textContent())?.trim() ?? "", {
        timeout: 10_000,
      })
      .toMatch(/^\d+$/);

    errors.assertClean();

    await page.getByRole("button", { name: "Inspector" }).click();
    await expect(page.getByText("Scene Explorer")).toBeVisible();
    // Inspector v2 may stack onboarding dialogs that hide the page from the a11y tree.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const dismiss = page.getByRole("button", { name: "dismiss" }).first();
      if (!(await dismiss.isVisible())) {
        break;
      }
      await dismiss.click();
    }
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
  });
});
