/**
 * E2E-only helpers for pointer interaction with the Babylon canvas.
 * Does not talk to GameTransport, Colyseus, simulation, or Scene APIs.
 */

import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { hudValue } from "./hud.js";

/**
 * Canvas-relative terrain point for MOVE (fixed 1280×720 + default camera).
 * Away from units / Sacred Site; verified to pick ground mesh.
 */
export const CANVAS_CLICK = {
  moveTerrain: { x: 640, y: 520 },
} as const;

/**
 * Inclusive RGB band plus channel separation.
 * Passed into the page so the scan stays a screenshot pixel test.
 */
interface RgbBand {
  minR: number;
  maxR: number;
  minG: number;
  maxG: number;
  minB: number;
  maxB: number;
  minBlueOverRed: number;
  minBlueOverGreen: number;
}

/** Player-0 unit material is palette `#3d8bfd` (low red, high blue). */
const LOCAL_UNIT_BLUE: RgbBand = {
  minR: 0,
  maxR: 99,
  minG: 100,
  maxG: 179,
  minB: 141,
  maxB: 255,
  minBlueOverRed: 0,
  minBlueOverGreen: 1,
};

/**
 * Objective material is diffuse (0.72, 0.55, 0.95) plus emissive (0.35, 0.18, 0.55).
 * Wide enough for lit and shaded faces. Red stays above the blue unit band so
 * player-0 pixels, white selection, and orange destination do not match.
 */
const OBJECTIVE_PURPLE: RgbBand = {
  minR: 105,
  maxR: 255,
  minG: 40,
  maxG: 210,
  minB: 140,
  maxB: 255,
  minBlueOverRed: 12,
  minBlueOverGreen: 20,
};

/** Lit face of the objective tower is far larger than anti-aliased fringes. */
const OBJECTIVE_MIN_PIXELS = 80;

const LOCAL_UNIT_MIN_PIXELS = 20;

/** Several CSS pixels: a real slide, not subpixel centroid noise. */
export const MIN_UNIT_MOVE_CSS_PX = 8;

/** Objective centroid may flicker by AA, but must not travel with the unit. */
export const MAX_OBJECTIVE_DRIFT_CSS_PX = 8;

export interface CanvasCentroid {
  x: number;
  y: number;
  count: number;
}

export async function canvasLocator(page: Page): Promise<Locator> {
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toBeVisible();
  return canvas;
}

/** Left-click on the canvas at a canvas-relative point (not page absolute). */
export async function canvasLeftClick(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const canvas = await canvasLocator(page);
  await canvas.click({ position, button: "left", force: true });
}

/** Right-click on the canvas at a canvas-relative point (issues MOVE via game input). */
export async function canvasRightClick(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const canvas = await canvasLocator(page);
  await canvas.click({ position, button: "right", force: true });
}

/**
 * Centroid of pixels matching `filter`, in CSS coordinates relative to the canvas.
 * Returns null when no pixel matches. Does not touch Scene, transport, or simulation.
 */
export async function measureColorCentroid(
  page: Page,
  filter: RgbBand,
): Promise<CanvasCentroid | null> {
  const canvas = await canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("canvas boundingBox unavailable");
  }

  const png = await canvas.screenshot();
  const sample = await page.evaluate(
    async ({ b64, band }) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const offscreen = document.createElement("canvas");
      offscreen.width = bitmap.width;
      offscreen.height = bitmap.height;
      const ctx = offscreen.getContext("2d");
      if (!ctx) {
        throw new Error("2d context unavailable");
      }
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          if (
            r >= band.minR &&
            r <= band.maxR &&
            g >= band.minG &&
            g <= band.maxG &&
            b >= band.minB &&
            b <= band.maxB &&
            b - r >= band.minBlueOverRed &&
            b - g >= band.minBlueOverGreen
          ) {
            sumX += x;
            sumY += y;
            count += 1;
          }
        }
      }
      return {
        count,
        cx: count > 0 ? sumX / count : null,
        cy: count > 0 ? sumY / count : null,
        width,
        height,
      };
    },
    { b64: png.toString("base64"), band: filter },
  );

  if (sample.cx === null || sample.cy === null || sample.count === 0) {
    return null;
  }

  return {
    x: (sample.cx * box.width) / sample.width,
    y: (sample.cy * box.height) / sample.height,
    count: sample.count,
  };
}

export function cssDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Locates the local (blue) unit by scanning a canvas screenshot for palette pixels.
 * Returns CSS coordinates relative to the canvas element.
 */
export async function findLocalUnitCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const sample = await measureColorCentroid(page, LOCAL_UNIT_BLUE);
  if (!sample || sample.count < LOCAL_UNIT_MIN_PIXELS) {
    throw new Error(`local unit pixels not found on canvas (count=${sample?.count ?? 0})`);
  }
  return { x: sample.x, y: sample.y };
}

/** Blue player-0 unit centroid. Same palette scan used to aim the selection click. */
export async function findLocalUnitCentroid(page: Page): Promise<CanvasCentroid> {
  const sample = await measureColorCentroid(page, LOCAL_UNIT_BLUE);
  if (!sample || sample.count < LOCAL_UNIT_MIN_PIXELS) {
    throw new Error(`local unit pixels not found on canvas (count=${sample?.count ?? 0})`);
  }
  return sample;
}

/**
 * Purple objective pixels on the Babylon canvas.
 * Returns the latest centroid once enough pixels match; otherwise the poll fails.
 */
export async function expectObjectiveOnCanvas(page: Page): Promise<CanvasCentroid> {
  await expect
    .poll(async () => (await measureColorCentroid(page, OBJECTIVE_PURPLE))?.count ?? 0, {
      timeout: 10_000,
      intervals: [200, 400, 800],
    })
    .toBeGreaterThanOrEqual(OBJECTIVE_MIN_PIXELS);

  const latest = await measureColorCentroid(page, OBJECTIVE_PURPLE);
  if (!latest || latest.count < OBJECTIVE_MIN_PIXELS) {
    throw new Error(`objective pixels disappeared (count=${latest?.count ?? 0})`);
  }
  return latest;
}

/**
 * Selects the local unit via real pointer input on the Babylon canvas.
 */
export async function selectLocalUnitByCanvasClick(page: Page): Promise<void> {
  const point = await findLocalUnitCanvasPoint(page);
  await canvasLeftClick(page, point);
  await expect
    .poll(async () => (await hudValue(page, "Selected").textContent())?.trim())
    .not.toBe("none");
}

/** PNG bytes of the game canvas (presentation surface). */
export async function captureCanvasPng(page: Page): Promise<Buffer> {
  const canvas = await canvasLocator(page);
  return canvas.screenshot();
}

/**
 * Decodes two PNG screenshots in the browser and returns the fraction of
 * pixels that differ beyond a small RGB threshold (presentation change).
 */
export async function measureCanvasPresentationChange(
  page: Page,
  beforePng: Buffer,
  afterPng: Buffer,
): Promise<number> {
  return page.evaluate(
    async ({ beforeB64, afterB64 }) => {
      const decode = async (b64: string): Promise<Uint8ClampedArray> => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "image/png" });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("2d context unavailable");
        }
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };

      const before = await decode(beforeB64);
      const after = await decode(afterB64);
      if (before.length !== after.length) {
        return 1;
      }

      const threshold = 12;
      let changed = 0;
      const pixels = before.length / 4;
      for (let i = 0; i < before.length; i += 4) {
        const dr = Math.abs(before[i]! - after[i]!);
        const dg = Math.abs(before[i + 1]! - after[i + 1]!);
        const db = Math.abs(before[i + 2]! - after[i + 2]!);
        if (dr > threshold || dg > threshold || db > threshold) {
          changed += 1;
        }
      }
      return changed / pixels;
    },
    {
      beforeB64: beforePng.toString("base64"),
      afterB64: afterPng.toString("base64"),
    },
  );
}
