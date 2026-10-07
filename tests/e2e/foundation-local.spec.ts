import { expect, test, type Page } from "@playwright/test";
import {
  CANVAS_CLICK,
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
 * F11 smoke: the same presentation path runs shared simulation in a real WebWorker.
 * MOVE is observed on the Babylon canvas, not by reading an internal DTO.
 */
test.describe("F11 local GameTransport browser smoke", () => {
  test("local worker connect, start, and primitive MOVE", async ({ page }) => {
    const errors = attachPageErrorCapture(page);
    const gameSockets: string[] = [];
    page.on("websocket", (socket) => {
      const url = socket.url();
      if (url.includes(":2567") || url.includes(":2568")) {
        gameSockets.push(url);
      }
    });

    await page.goto("/?transport=local");
    await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();

    const workerAppeared = page.waitForEvent("worker", { timeout: 20_000 });
    await page.getByRole("button", { name: "Create room" }).click();
    const worker = await workerAppeared;
    expect(page.workers().length).toBeGreaterThan(0);
    expect(worker.url()).toMatch(/local-simulation|worker/i);

    await expectHud(page, "Status", "connected");
    await expectHud(page, "Room", "local");
    await expectHud(page, "Players", "1");
    expect(gameSockets, "local mode must not open a game-server socket").toEqual([]);

    await page.getByRole("button", { name: "Start" }).click();
    await expectHud(page, "Phase", "RUNNING");
    await expectHud(page, "Players", "1");
    await expectHud(page, "Objectives", "1");
    await expect
      .poll(async () => Number((await hudValue(page, "Entities").textContent())?.trim()))
      .toBeGreaterThanOrEqual(2);

    await expectObjectiveOnCanvas(page);
    const beforeMove = await captureCanvasPng(page);
    const unitBefore = await findLocalUnitCentroid(page);
    await saveLocalShot(page, "running-local.png");

    await selectLocalUnitByCanvasClick(page);
    await expect
      .poll(async () => (await hudValue(page, "Selected").textContent())?.trim())
      .not.toBe("none");

    await canvasRightClick(page, CANVAS_CLICK.moveTerrain);
    await expectHud(page, "Destination", "marked");

    await expect
      .poll(
        async () => {
          const after = await findLocalUnitCentroid(page).catch(() => null);
          return after ? cssDistance(unitBefore, after) : 0;
        },
        { timeout: 20_000, intervals: [400, 700, 1000] },
      )
      .toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);

    const afterMove = await captureCanvasPng(page);
    const change = await measureCanvasPresentationChange(page, beforeMove, afterMove);
    expect(change, "canvas should change after local MOVE").toBeGreaterThan(0.0005);
    const unitAfter = await findLocalUnitCentroid(page);
    expect(cssDistance(unitBefore, unitAfter)).toBeGreaterThanOrEqual(MIN_UNIT_MOVE_CSS_PX);
    await expectHud(page, "Objectives", "1");
    await saveLocalShot(page, "after-move-local.png");

    expect(gameSockets, "MOVE must stay inside the local worker").toEqual([]);
    errors.assertClean();
  });
});

/** Regression: observe the rendered trajectory, without inspecting simulation state. */
test("G4a open-terrain diagonal MOVE stays on a straight rendered line", async ({ page }) => {
  const errors = attachPageErrorCapture(page);
  await page.goto("/?transport=local");
  await page.getByRole("button", { name: "Create room" }).click();
  await expectHud(page, "Status", "connected");
  await page.getByRole("button", { name: "Start" }).click();
  await expectHud(page, "Phase", "RUNNING");
  await selectLocalUnitByCanvasClick(page);
  const start = await findLocalUnitCentroid(page);
  // Same unobstructed ground point used by the internal browser playtest.
  await canvasRightClick(page, { x: 950, y: 300 });
  await expectHud(page, "Destination", "marked");
  const samples = [start];
  let stable = 0;
  for (let index = 0; index < 50 && stable < 3; index += 1) {
    const sample = await findLocalUnitCentroid(page);
    stable = cssDistance(samples.at(-1)!, sample) < 1 ? stable + 1 : 0;
    samples.push(sample);
  }
  expect(stable, "unit must arrive and stop").toBe(3);
  const end = samples.at(-1)!;
  const length = cssDistance(start, end);
  expect(length).toBeGreaterThan(300);
  // The fixed camera projects a straight world segment to a straight screen line.
  // A few pixels accommodate anti-aliasing of the primitive's centroid.
  for (const sample of samples) {
    const cross =
      (sample.x - start.x) * (end.y - start.y) - (sample.y - start.y) * (end.x - start.x);
    expect(Math.abs(cross) / length, "trajectory must not expose a grid-shaped turn").toBeLessThan(
      4,
    );
  }
  expect(
    samples.filter((sample) => cssDistance(start, sample) > 30 && cssDistance(end, sample) > 30)
      .length,
  ).toBeGreaterThanOrEqual(2);
  await expectHud(page, "Last event", "—");
  errors.assertClean();
});

async function saveLocalShot(page: Page, fileName: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve("docs/verification/f11");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, fileName), fullPage: true });
}
