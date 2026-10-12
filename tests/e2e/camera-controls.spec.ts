import { expect, test, type Page } from "@playwright/test";
import {
  captureCanvasPng,
  measureCanvasPresentationChange,
  selectLocalUnitByCanvasClick,
  canvasRightClick,
  measureColorCentroid,
  cssDistance,
} from "./helpers/canvas.js";
import { attachPageErrorCapture, expectHud } from "./helpers/hud.js";

async function expectObjectiveOnCanvas(page: Page) {
  const sample = await measureColorCentroid(page, {
    minR: 150,
    maxR: 255,
    minG: 40,
    maxG: 210,
    minB: 140,
    maxB: 255,
    minBlueOverRed: 12,
    minBlueOverGreen: 20,
  });
  expect(sample).not.toBeNull();
  return sample!;
}
async function hold(page: Page, key: string, ms = 450) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function home(page: Page) {
  await page.locator("#game-canvas").focus();
  await page.keyboard.press("Home");
  await page.mouse.move(800, 400);
  await page.waitForTimeout(350);
}
async function shot(page: Page, name: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir("docs/verification/c1-96", { recursive: true });
  await page.screenshot({ path: `docs/verification/c1-96/${name}.png` });
}
// Read the rendered marker in a small ground region, excluding the white selection ring.
async function markerCentroid(page: Page) {
  const clip = { x: 750, y: 450, width: 100, height: 100 };
  const png = await page.screenshot({ clip });
  const center = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let xSum = 0,
      ySum = 0,
      count = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i]! > 230 && data[i + 1]! > 220 && data[i + 2]! > 160) {
          xSum += x;
          ySum += y;
          count++;
        }
      }
    return count ? { x: xSum / count, y: ySum / count, count } : null;
  }, png.toString("base64"));
  return center ? { ...center, x: center.x + clip.x, y: center.y + clip.y } : null;
}

for (const mode of ["local", "remote"])
  test(`C1 physical camera controls and commands (${mode})`, async ({ page, context }) => {
    test.setTimeout(180_000);
    const errors = attachPageErrorCapture(page);
    await page.goto(mode === "local" ? "/?transport=local" : "/");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expectHud(page, "Status", "connected");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expectHud(page, "Phase", "RUNNING");
    await page.locator("#game-canvas").focus();
    await page.mouse.move(800, 400);
    await shot(page, `${mode}-normal`);

    // Physical key repeats and all four orientations; screen-up stays screen-up.
    for (let orientation = 0; orientation < 4; orientation++) {
      await home(page);
      for (let turn = 0; turn < orientation; turn++) {
        await page.keyboard.press("e");
        await page.waitForTimeout(350);
      }
      const before = await expectObjectiveOnCanvas(page);
      await hold(page, "w");
      const after = await expectObjectiveOnCanvas(page);
      expect(after.y - before.y).toBeGreaterThan(10);
      expect(Math.abs(after.x - before.x)).toBeLessThan(5);
      await hold(page, "s");
      const horizontal = await expectObjectiveOnCanvas(page);
      await hold(page, "d");
      expect((await expectObjectiveOnCanvas(page)).x).toBeLessThan(horizontal.x - 10);
      await hold(page, "a");
      await shot(page, `${mode}-yaw-${orientation}`);
    }
    await home(page);
    const start = await expectObjectiveOnCanvas(page);
    await hold(page, "ArrowRight", 150);
    const slow = await expectObjectiveOnCanvas(page);
    await home(page);
    await page.keyboard.down("Shift");
    await hold(page, "ArrowRight", 150);
    await page.keyboard.up("Shift");
    const fast = await expectObjectiveOnCanvas(page);
    expect(start.x - fast.x).toBeGreaterThan((start.x - slow.x) * 1.7);
    await home(page);
    const normal = await captureCanvasPng(page);
    await hold(page, "r", 600);
    const close = await captureCanvasPng(page);
    expect(await measureCanvasPresentationChange(page, normal, close)).toBeGreaterThan(0.02);
    await hold(page, "f", 1500);
    await shot(page, `${mode}-strategic`);
    await page.keyboard.press("q");
    await page.waitForTimeout(350);
    await hold(page, "q", 800); // repeat does not add turns
    await home(page);

    // Typing and focus switches must not retain held camera inputs.
    const fixed = await expectObjectiveOnCanvas(page);
    await page.getByRole("textbox", { name: "Join room id" }).fill("wasdqerf");
    await hold(page, "w", 400);
    await page.keyboard.press("Home");
    expect(cssDistance(fixed, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await page.locator("#game-canvas").focus();
    await page.keyboard.down("d");
    await page.getByRole("textbox", { name: "Join room id" }).click();
    await page.keyboard.up("d");
    const stopped = await expectObjectiveOnCanvas(page);
    await page.waitForTimeout(350);
    expect(cssDistance(stopped, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await home(page);
    await page.keyboard.down("w");
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    await page.keyboard.up("w");
    await page.bringToFront();
    const resumed = await expectObjectiveOnCanvas(page);
    await page.waitForTimeout(350);
    expect(cssDistance(resumed, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await other.close();
    await home(page);

    // Edge zone is canvas-relative, blocked by overlays and disabled by checkbox.
    const edgeBefore = await expectObjectiveOnCanvas(page);
    await page.mouse.move(1278, 450);
    await page.waitForTimeout(450);
    await page.mouse.move(800, 400);
    expect((await expectObjectiveOnCanvas(page)).x).toBeLessThan(edgeBefore.x - 10);
    await shot(page, `${mode}-edge`);
    for (const point of [
      { x: 2, y: 300 },
      { x: 650, y: 2 },
      { x: 650, y: 718 },
      { x: 2, y: 2 },
      { x: 1278, y: 2 },
      { x: 2, y: 718 },
      { x: 1278, y: 718 },
    ]) {
      await home(page);
      const before = await captureCanvasPng(page);
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(250);
      await page.mouse.move(800, 400);
      expect(
        await measureCanvasPresentationChange(page, before, await captureCanvasPng(page)),
      ).toBeGreaterThan(0.005);
    }
    await home(page);
    const overlay = await expectObjectiveOnCanvas(page);
    await page.mouse.move(18, 300);
    await page.waitForTimeout(350);
    expect(cssDistance(overlay, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await page.mouse.move(1285, 450);
    await page.waitForTimeout(350);
    expect(cssDistance(overlay, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await page.getByRole("checkbox", { name: "Edge scrolling" }).uncheck();
    await home(page);
    const disabled = await expectObjectiveOnCanvas(page);
    await page.mouse.move(1278, 450);
    await page.waitForTimeout(450);
    expect(cssDistance(disabled, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await page.mouse.move(800, 400);

    // Drag never creates a command, including a drag that returns to the start.
    await home(page);
    await selectLocalUnitByCanvasClick(page);
    await page.mouse.move(800, 450);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(900, 500, { steps: 8 });
    await page.mouse.move(800, 450, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await expectHud(page, "Destination", "none");
    await shot(page, `${mode}-right-drag`);
    await page.mouse.move(800, 450);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(900, 450, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    await expectHud(page, "Destination", "none");
    await page.mouse.move(800, 450);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(1300, 450, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await expectHud(page, "Destination", "none");
    await home(page);
    await canvasRightClick(page, { x: 800, y: 500 });
    await expectHud(page, "Destination", "marked");
    await shot(page, `${mode}-move`);

    // The rendered ground marker stays under the cursor through wheel zoom.
    const markerBefore = await markerCentroid(page);
    expect(markerBefore).not.toBeNull();
    await page.mouse.move(markerBefore!.x, markerBefore!.y);
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(650);
    const markerAfter = await markerCentroid(page);
    expect(markerAfter).not.toBeNull();
    expect(cssDistance(markerBefore!, markerAfter!)).toBeLessThan(5);
    await shot(page, `${mode}-cursor-zoom`);

    // Long pan into map boundaries settles, without invalid pose or jitter.
    await home(page);
    await hold(page, "d", 2500);
    const bound = await captureCanvasPng(page);
    await hold(page, "d", 350);
    expect(
      await measureCanvasPresentationChange(page, bound, await captureCanvasPng(page)),
    ).toBeLessThan(0.002);
    await page.getByRole("checkbox", { name: "Edge scrolling" }).check();
    errors.assertClean();
  });
