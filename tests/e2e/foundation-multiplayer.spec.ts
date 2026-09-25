import { expect, test, type Page } from "@playwright/test";
import {
  CANVAS_CLICK,
  MAX_OBJECTIVE_DRIFT_CSS_PX,
  MIN_UNIT_MOVE_CSS_PX,
  captureCanvasPng,
  canvasRightClick,
  cssDistance,
  expectObjectiveOnCanvas,
  findLocalUnitCentroid,
  measureCanvasPresentationChange,
  selectLocalUnitByCanvasClick,
} from "./helpers/canvas.js";
import { attachPageErrorCapture, expectHud, hudValue } from "./helpers/hud.js";

/**
 * F7 smoke: two independent BrowserContexts prove the full production path
 * Browser → React/UI → pointer → GameTransport → Colyseus → server → simulation
 * → replication → ClientGameState → Babylon, observed on both clients.
 */
test.describe("F7 foundation multiplayer browser E2E", () => {
  test("two browsers create/join, start, Sacred Site, and authoritative MOVE", async ({
    browser,
  }) => {
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
      await expect(pageA.getByRole("button", { name: "Create room" })).toBeVisible();

      await pageA.getByRole("button", { name: "Create room" }).click();
      await expectHud(pageA, "Status", "connected");
      await expect
        .poll(async () => (await hudValue(pageA, "Room").textContent())?.trim())
        .not.toBe("—");

      const roomId = (await hudValue(pageA, "Room").textContent())?.trim();
      expect(roomId, "room id from HUD").toBeTruthy();

      await pageB.goto("/");
      await pageB.getByLabel("Join room id").fill(roomId!);
      await pageB.getByRole("button", { name: "Join room" }).click();
      await expectHud(pageB, "Status", "connected");

      await expectHud(pageA, "Players", "2");
      await expectHud(pageB, "Players", "2");

      await pageA.getByRole("button", { name: "Start" }).click();
      await expectHud(pageA, "Phase", "RUNNING");
      await expectHud(pageB, "Phase", "RUNNING");

      // Generic objective observability from replicated state (F6 Sacred Site).
      await expectHud(pageA, "Objectives", "1");
      await expectHud(pageB, "Objectives", "1");
      await expect
        .poll(async () => Number((await hudValue(pageA, "Entities").textContent())?.trim()))
        .toBeGreaterThanOrEqual(3);
      await expect
        .poll(async () => Number((await hudValue(pageB, "Entities").textContent())?.trim()))
        .toBeGreaterThanOrEqual(3);

      // Canvas pixels, not only the HUD count: the purple objective mesh is drawn.
      const objectiveBeforeA = await expectObjectiveOnCanvas(pageA);
      const objectiveBeforeB = await expectObjectiveOnCanvas(pageB);

      if (process.env.F7_SAVE_VERIFICATION_SHOTS === "1") {
        await saveVerificationShot(pageA, "running-a.png");
        await saveVerificationShot(pageB, "running-b.png");
      }

      const beforeMoveB = await captureCanvasPng(pageB);
      const beforeMoveA = await captureCanvasPng(pageA);
      const unitBeforeB = await findLocalUnitCentroid(pageB);

      await selectLocalUnitByCanvasClick(pageA);
      await expect
        .poll(async () => (await hudValue(pageA, "Selected").textContent())?.trim())
        .not.toBe("none");

      await canvasRightClick(pageA, CANVAS_CLICK.moveTerrain);
      await expectHud(pageA, "Destination", "marked");

      // Authoritative movement on B: the same blue unit centroid must travel.
      await expect
        .poll(
          async () => {
            const after = await findLocalUnitCentroid(pageB).catch(() => null);
            return after ? cssDistance(unitBeforeB, after) : 0;
          },
          { timeout: 20_000, intervals: [400, 700, 1000] },
        )
        .toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);

      const afterMoveA = await captureCanvasPng(pageA);
      const afterMoveB = await captureCanvasPng(pageB);
      const changeA = await measureCanvasPresentationChange(pageA, beforeMoveA, afterMoveA);
      const changeB = await measureCanvasPresentationChange(pageB, beforeMoveB, afterMoveB);
      expect(changeA, "client A canvas should change after MOVE").toBeGreaterThan(0.0005);
      expect(changeB, "client B canvas should change after the unit moves").toBeGreaterThan(0.0005);

      const unitAfterB = await findLocalUnitCentroid(pageB);
      expect(
        cssDistance(unitBeforeB, unitAfterB),
        "client B must show player-0 unit displacement",
      ).toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);

      // Sacred Site stays: HUD count plus the purple mesh still at the same canvas spot.
      await expectHud(pageA, "Objectives", "1");
      await expectHud(pageB, "Objectives", "1");
      const objectiveAfterA = await expectObjectiveOnCanvas(pageA);
      const objectiveAfterB = await expectObjectiveOnCanvas(pageB);
      expect(cssDistance(objectiveBeforeA, objectiveAfterA)).toBeLessThan(
        MAX_OBJECTIVE_DRIFT_CSS_PX,
      );
      expect(cssDistance(objectiveBeforeB, objectiveAfterB)).toBeLessThan(
        MAX_OBJECTIVE_DRIFT_CSS_PX,
      );

      if (process.env.F7_SAVE_VERIFICATION_SHOTS === "1") {
        await saveVerificationShot(pageA, "after-move-a.png");
        await saveVerificationShot(pageB, "after-move-b.png");
      }

      errorsA.assertClean();
      errorsB.assertClean();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

async function saveVerificationShot(page: Page, fileName: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve("docs/verification/f7");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, fileName), fullPage: true });
}
