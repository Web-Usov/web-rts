import { expect, test } from "@playwright/test";
import {
  canvasLeftClick,
  canvasRightClick,
  cssDistance,
  findSoldierCentroid,
  findSelectedSoldierCentroid,
  findWorkerCentroid,
  expectObjectiveOnCanvas,
} from "./helpers/canvas.js";
import { attachPageErrorCapture, expectHud, hudValue } from "./helpers/hud.js";

test("G6 Local Soldier proxy supports MOVE and blocked-target regression", async ({ page }) => {
  const errors = attachPageErrorCapture(page);
  await page.goto("/?transport=local");
  await page.getByRole("button", { name: "Create room" }).click();
  await expectHud(page, "Status", "connected");
  await page.getByRole("button", { name: "Start" }).click();
  await expectHud(page, "Phase", "RUNNING");
  await expectHud(page, "Entities", "9");
  await expectObjectiveOnCanvas(page);
  const workerBefore = await findWorkerCentroid(page);
  const before = await findSoldierCentroid(page);
  await canvasLeftClick(page, workerBefore);
  await expectHud(page, "Selected", "3");
  await canvasRightClick(page, { x: 800, y: 470 });
  await expectHud(page, "Destination", "marked");
  // Soldier's separate, declarative spawn; coordinate confirmed by internal playtest.
  await canvasLeftClick(page, { x: 518, y: 314 });
  await expectHud(page, "Selected", "9");
  await canvasRightClick(page, { x: 950, y: 300 });
  await expectHud(page, "Destination", "marked");
  await expect
    .poll(async () => {
      const after = await findSelectedSoldierCentroid(page);
      return after === null ? 0 : cssDistance(before, after);
    })
    .toBeGreaterThan(250);
  await expect
    .poll(async () => cssDistance(workerBefore, await findWorkerCentroid(page)))
    .toBeGreaterThan(100);
  await canvasRightClick(page, { x: 668, y: 362 });
  await expect
    .poll(async () => {
      const after = await findSelectedSoldierCentroid(page);
      return after === null ? Infinity : cssDistance(before, after);
    })
    .toBeLessThan(200);
  await expectHud(page, "Last event", "—");
  await expectHud(page, "Objectives", "1");
  errors.assertClean();
});

test("G6 Remote Soldier MOVE is visible to both clients and survives reconnect", async ({
  browser,
}) => {
  const a = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const pageA = await a.newPage(),
      pageB = await b.newPage();
    const errorsA = attachPageErrorCapture(pageA),
      errorsB = attachPageErrorCapture(pageB);
    await pageA.goto("/");
    await pageA.getByRole("button", { name: "Create room" }).click();
    await expectHud(pageA, "Status", "connected");
    const room = (await hudValue(pageA, "Room").textContent())!.trim();
    await pageB.goto("/");
    await pageB.getByLabel("Join room id").fill(room);
    await pageB.getByRole("button", { name: "Join room" }).click();
    await expectHud(pageA, "Players", "2");
    await pageA.getByRole("button", { name: "Start" }).click();
    await expectHud(pageA, "Phase", "RUNNING");
    await expectHud(pageB, "Phase", "RUNNING");
    await expectHud(pageA, "Entities", "13");
    await expectHud(pageB, "Entities", "13");
    await canvasLeftClick(pageA, { x: 518, y: 314 });
    await expectHud(pageA, "Selected", "12");
    const beforeA = await findSoldierCentroid(pageA);
    const before = await findSoldierCentroid(pageB);
    expect(cssDistance(beforeA, before)).toBeLessThan(3);
    await canvasRightClick(pageA, { x: 950, y: 300 });
    await expectHud(pageA, "Destination", "marked");
    await expect
      .poll(async () => cssDistance(before, await findSoldierCentroid(pageB)))
      .toBeGreaterThan(250);
    const player = (await hudValue(pageA, "Local player").textContent())!.trim();
    await pageA.reload();
    await expectHud(pageA, "Status", "connected");
    await expectHud(pageA, "Local player", player);
    await expectHud(pageA, "Phase", "RUNNING");
    await expectHud(pageA, "Entities", "13");
    await expectHud(pageB, "Players", "2");
    await expect
      .poll(async () =>
        cssDistance(await findSoldierCentroid(pageA), await findSoldierCentroid(pageB)),
      )
      .toBeLessThan(3);
    errorsA.assertClean();
    errorsB.assertClean();
  } finally {
    await a.close();
    await b.close();
  }
});
