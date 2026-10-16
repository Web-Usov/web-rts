import { expect, test, type Page } from "@playwright/test";
import {
  captureCanvasPng,
  measureCanvasPresentationChange,
  selectLocalUnitByCanvasClick,
  canvasRightClick,
  measureColorCentroid,
  cssDistance,
} from "./helpers/canvas.js";
import { installGroundReference, measureGroundReference } from "./helpers/camera-reference.js";
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
  const directory = process.env.VERIFICATION_DIR ?? ".artifacts/verification/c2-112";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}.png` });
}

for (const mode of ["local", "remote"])
  test(`C1 physical camera controls and commands (${mode})`, async ({ page, context }) => {
    test.setTimeout(180_000);
    const errors = attachPageErrorCapture(page);
    // Opt-in stress mode for flake diagnosis: E2E_CPU_THROTTLE=6 slows the renderer 6x.
    const throttleRaw = process.env.E2E_CPU_THROTTLE;
    const throttle = throttleRaw === undefined || throttleRaw === "" ? 1 : Number(throttleRaw);
    if (!Number.isFinite(throttle) || throttle < 1)
      throw new Error(`E2E_CPU_THROTTLE must be a number >= 1, got "${throttleRaw}"`);
    if (throttle > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
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
    await hold(page, "ArrowUp", 300);
    const slow = await expectObjectiveOnCanvas(page);
    await home(page);
    await page.keyboard.down("Shift");
    await hold(page, "ArrowUp", 300);
    await page.keyboard.up("Shift");
    const fast = await expectObjectiveOnCanvas(page);
    expect(fast.y - start.y).toBeGreaterThan((slow.y - start.y) * 1.7);
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

    // A second pointer cannot move, finish or cancel an existing physical mouse grab.
    await home(page);
    await selectLocalUnitByCanvasClick(page);
    await page.locator("#game-canvas").evaluate((canvas) => {
      canvas.addEventListener(
        "pointerdown",
        (event) => {
          canvas.setAttribute("data-review-pointer-id", String((event as PointerEvent).pointerId));
        },
        { once: true },
      );
    });
    await page.mouse.move(800, 450);
    await page.mouse.down({ button: "right" });
    const grabBefore = await expectObjectiveOnCanvas(page);
    await page.locator("#game-canvas").evaluate((canvas) => {
      const id = Number(canvas.getAttribute("data-review-pointer-id"));
      canvas.removeAttribute("data-review-pointer-id");
      for (const identity of [
        { pointerId: id + 10, pointerType: "mouse", target: window },
        { pointerId: id, pointerType: "touch", target: window },
        { pointerId: id + 10, pointerType: "touch", target: canvas },
      ]) {
        // Mouse up/cancel on canvas also reaches Babylon's single-mouse device,
        // which releases native capture regardless of the synthetic pointer id.
        const types =
          identity.target === canvas
            ? ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]
            : ["pointermove", "pointerup"];
        for (const type of types)
          identity.target.dispatchEvent(
            new PointerEvent(type, {
              pointerId: identity.pointerId,
              pointerType: identity.pointerType,
              bubbles: true,
              clientX: 1050,
              clientY: 550,
              button: 2,
              buttons: 2,
            }),
          );
      }
    });
    expect(cssDistance(grabBefore, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await expectHud(page, "Destination", "none");
    await page.mouse.move(850, 450, { steps: 8 });
    expect((await expectObjectiveOnCanvas(page)).x - grabBefore.x).toBeGreaterThan(20);
    await page.mouse.up({ button: "right" });
    await expectHud(page, "Destination", "none");
    await shot(page, `${mode}-pointer-identity`);

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
    await home(page);
    await page.keyboard.down("w");
    await page.mouse.move(800, 450);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(900, 450, { steps: 8 });
    await page.mouse.move(800, 450, { steps: 8 });
    // Baseline is taken while the gesture is still active: W is held but keyboard pan
    // is suspended. Measuring after pointerup races with the resumed pan (a screenshot
    // under CPU load takes long enough for the camera to run away or hit the map edge).
    const duringDrag = await expectObjectiveOnCanvas(page);
    expect(cssDistance(duringDrag, await expectObjectiveOnCanvas(page))).toBeLessThan(2);
    await page.mouse.up({ button: "right" });
    // Pan speed is px/s of frame dt (capped per frame), so displacement per wall-clock
    // interval depends on FPS. Wait for the observable shift instead of a fixed sleep.
    await expect
      .poll(async () => (await expectObjectiveOnCanvas(page)).y - duringDrag.y, {
        timeout: 15_000,
      })
      .toBeGreaterThan(10);
    await page.keyboard.up("w");
    await expectHud(page, "Destination", "none");
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

    // The destination is soon occluded by the moving selected unit. Its white
    // selection ring is not a fixed ground reference. Use an isolated, flat
    // rendered fiducial; the oracle reads screenshots, not camera state.
    const interiorCursor = { x: 850, y: 430 };
    await installGroundReference(page, interiorCursor);
    const interiorBefore = await measureGroundReference(page);
    await page.mouse.move(interiorCursor.x, interiorCursor.y);
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(650);
    expect(cssDistance(interiorBefore, await measureGroundReference(page))).toBeLessThan(2);
    await shot(page, `${mode}-cursor-zoom`);

    // Long pan into map boundaries settles, without invalid pose or jitter.
    await home(page);
    await hold(page, "d", 2500);
    const bound = await captureCanvasPng(page);
    await hold(page, "d", 350);
    expect(
      await measureCanvasPresentationChange(page, bound, await captureCanvasPng(page)),
    ).toBeLessThan(0.002);
    // At the right pan limit, zoom-in would move the target beyond the map.
    // Bounds take precedence: a visible displacement is expected, then settles.
    const cursor = { x: 850, y: 430 };
    await installGroundReference(page, cursor);
    const constrainedBefore = await measureGroundReference(page);
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(650);
    const constrainedAfter = await measureGroundReference(page);
    const displacement = cssDistance(constrainedBefore, constrainedAfter);
    console.log(JSON.stringify({ mode, boundedDisplacement: displacement }));
    // Both target axes are pinned at 10 in this pose. Projecting the fixed
    // ground point at radius 28 -> 22.5 predicts 64.2 CSS px of displacement.
    expect(Math.abs(displacement - 64.2)).toBeLessThan(2);
    await page.waitForTimeout(350);
    expect(cssDistance(constrainedAfter, await measureGroundReference(page))).toBeLessThan(1);
    await shot(page, `${mode}-bounded-zoom`);
    await page.getByRole("checkbox", { name: "Edge scrolling" }).check();
    errors.assertClean();
  });

for (const mode of ["local", "remote"])
  test(`C2 rendered ground anchor at four yaws without drift (${mode})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = attachPageErrorCapture(page);
    await page.goto(mode === "local" ? "/?transport=local" : "/");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expectHud(page, "Status", "connected");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expectHud(page, "Phase", "RUNNING");
    await page.getByRole("checkbox", { name: "Edge scrolling" }).uncheck();
    for (let orientation = 0; orientation < 4; orientation++) {
      await home(page);
      for (let turn = 0; turn < orientation; turn++) {
        await page.keyboard.press("e");
        await page.waitForTimeout(350);
      }
      const cursor = { x: 850, y: 430 };
      await installGroundReference(page, cursor);
      const before = await measureGroundReference(page);
      expect(cssDistance(cursor, before)).toBeLessThan(2);
      let maximumDrift = 0;
      await page.mouse.move(cursor.x, cursor.y);
      for (const delta of [-220, 220, -220, 220]) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(650);
        const drift = cssDistance(before, await measureGroundReference(page));
        maximumDrift = Math.max(maximumDrift, drift);
        expect(drift).toBeLessThan(2);
      }
      const settled = await measureGroundReference(page);
      await page.waitForTimeout(350);
      expect(cssDistance(settled, await measureGroundReference(page))).toBeLessThan(1);
      console.log(JSON.stringify({ mode, orientation, maximumDrift }));
      await shot(page, `${mode}-cursor-zoom-${orientation}`);
      // Negative control: the pixel oracle must detect actual physical pan.
      await hold(page, "d", 200);
      expect(cssDistance(before, await measureGroundReference(page))).toBeGreaterThan(10);
    }

    errors.assertClean();
  });
