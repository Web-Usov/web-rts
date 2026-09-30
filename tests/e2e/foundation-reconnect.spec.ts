import { expect, test, type Page } from "@playwright/test";
import {
  CANVAS_CLICK,
  MAX_OBJECTIVE_DRIFT_CSS_PX,
  MIN_UNIT_MOVE_CSS_PX,
  canvasRightClick,
  cssDistance,
  expectObjectiveOnCanvas,
  findLocalUnitCentroid,
  selectLocalUnitByCanvasClick,
} from "./helpers/canvas.js";
import { attachPageErrorCapture, expectHud, hudValue } from "./helpers/hud.js";

/**
 * F8: real page.reload() of client A. Resume uses the sessionStorage token
 * inside RemoteGameTransport — the test does not call transport APIs.
 */
test.describe("F8 foundation reconnect browser E2E", () => {
  test("reload restores the same player and authoritative MOVE", async ({ browser }) => {
    const contextA = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const contextB = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const errorsA = attachPageErrorCapture(pageA);
    const errorsB = attachPageErrorCapture(pageB);

    try {
      await pageA.goto("/");
      await pageA.getByRole("button", { name: "Create room" }).click();
      await expectHud(pageA, "Status", "connected");
      await expect
        .poll(async () => (await hudValue(pageA, "Room").textContent())?.trim())
        .not.toBe("—");

      const roomId = (await hudValue(pageA, "Room").textContent())?.trim();
      expect(roomId, "room id from HUD").toBeTruthy();
      const localPlayerA = (await hudValue(pageA, "Local player").textContent())?.trim();
      expect(localPlayerA).toBeTruthy();

      await pageB.goto("/");
      await pageB.getByLabel("Join room id").fill(roomId!);
      await pageB.getByRole("button", { name: "Join room" }).click();
      await expectHud(pageB, "Status", "connected");
      await expectHud(pageA, "Players", "2");
      await expectHud(pageB, "Players", "2");

      await pageA.getByRole("button", { name: "Start" }).click();
      await expectHud(pageA, "Phase", "RUNNING");
      await expectHud(pageB, "Phase", "RUNNING");
      await expectHud(pageA, "Objectives", "1");
      await expectHud(pageB, "Objectives", "1");

      const objectiveBefore = await expectObjectiveOnCanvas(pageA);
      const storageBefore = await resumeStorageFlags(pageA);
      expect(storageBefore).toEqual({ session: true, local: false });

      if (process.env.F8_SAVE_VERIFICATION_SHOTS === "1") {
        await saveVerificationShot(pageA, "before-reload.png");
      }

      const sawPeerDrop = waitForHudValue(pageB, "Players", "1", 15_000);
      await pageA.reload({ waitUntil: "domcontentloaded" });
      await expect(sawPeerDrop).resolves.toBe(true);

      if (process.env.F8_SAVE_VERIFICATION_SHOTS === "1") {
        await saveVerificationShot(pageB, "peer-sees-disconnected.png");
      }

      await expectHud(pageA, "Status", "connected");
      await expectHud(pageA, "Room", roomId!);
      await expectHud(pageA, "Local player", localPlayerA!);
      await expectHud(pageA, "Phase", "RUNNING");
      await expectHud(pageA, "Objectives", "1");
      await expectHud(pageA, "Players", "2");
      await expectHud(pageB, "Players", "2");
      await expectHud(pageB, "Phase", "RUNNING");

      const storageAfter = await resumeStorageFlags(pageA);
      expect(storageAfter).toEqual({ session: true, local: false });

      const objectiveAfterA = await expectObjectiveOnCanvas(pageA);
      const objectiveAfterB = await expectObjectiveOnCanvas(pageB);
      expect(cssDistance(objectiveBefore, objectiveAfterA)).toBeLessThan(
        MAX_OBJECTIVE_DRIFT_CSS_PX,
      );

      if (process.env.F8_SAVE_VERIFICATION_SHOTS === "1") {
        await saveVerificationShot(pageA, "after-reconnect.png");
      }

      const unitBeforeB = await findLocalUnitCentroid(pageB);
      await selectLocalUnitByCanvasClick(pageA);
      await expect
        .poll(async () => (await hudValue(pageA, "Selected").textContent())?.trim())
        .not.toBe("none");

      await canvasRightClick(pageA, CANVAS_CLICK.moveTerrain);
      await expectHud(pageA, "Destination", "marked");

      await expect
        .poll(
          async () => {
            const after = await findLocalUnitCentroid(pageB).catch(() => null);
            return after ? cssDistance(unitBeforeB, after) : 0;
          },
          { timeout: 20_000, intervals: [400, 700, 1000] },
        )
        .toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);

      const unitAfterB = await findLocalUnitCentroid(pageB);
      expect(cssDistance(unitBeforeB, unitAfterB)).toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);
      await expectHud(pageA, "Objectives", "1");
      await expectHud(pageB, "Objectives", "1");
      const objectiveAfterMoveB = await expectObjectiveOnCanvas(pageB);
      expect(cssDistance(objectiveAfterB, objectiveAfterMoveB)).toBeLessThan(
        MAX_OBJECTIVE_DRIFT_CSS_PX,
      );

      await pageA.getByRole("button", { name: "Disconnect" }).click();
      await expectHud(pageA, "Status", "disconnected");
      await expectHud(pageA, "Room", "—");
      await expectHud(pageA, "Phase", "-");
      await expectHud(pageA, "Entities", "0");
      await expectHud(pageA, "Objectives", "0");
      await expectHud(pageA, "Selected", "none");
      await expectHud(pageA, "Destination", "none");
      await expect
        .poll(async () => {
          try {
            await findLocalUnitCentroid(pageA);
            return "visible";
          } catch {
            return "gone";
          }
        })
        .toBe("gone");

      if (process.env.F8_SAVE_VERIFICATION_SHOTS === "1") {
        await saveVerificationShot(pageA, "after-disconnect.png");
        await saveVerificationShot(pageB, "after-reconnect-move.png");
      }

      errorsA.assertClean();
      errorsB.assertClean();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

/** Presence only — the token value is not returned to the test runner. */
async function resumeStorageFlags(page: Page): Promise<{ session: boolean; local: boolean }> {
  return page.evaluate(() => ({
    session: sessionStorage.getItem("web-rts.reconnectionToken") !== null,
    local: localStorage.getItem("web-rts.reconnectionToken") !== null,
  }));
}

async function waitForHudValue(
  page: Page,
  label: string,
  value: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await hudValue(page, label).textContent())?.trim();
    if (text === value) {
      return true;
    }
    await page.waitForTimeout(40);
  }
  return false;
}

async function saveVerificationShot(page: Page, fileName: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve("docs/verification/f8");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, fileName), fullPage: true });
}
