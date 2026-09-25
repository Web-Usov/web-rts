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

/** Player-0 unit material is palette `#3d8bfd`. */
const LOCAL_UNIT_BLUE = {
  maxR: 100,
  minG: 100,
  maxG: 180,
  minB: 140,
} as const;

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
 * Locates the local (blue) unit by scanning a canvas screenshot for palette pixels.
 * Returns CSS coordinates relative to the canvas element.
 */
export async function findLocalUnitCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const canvas = await canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("canvas boundingBox unavailable");
  }

  const png = await canvas.screenshot();
  const sample = await page.evaluate(
    async ({ b64, filter }) => {
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
          if (r < filter.maxR && g >= filter.minG && g < filter.maxG && b > filter.minB && b > g) {
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
    { b64: png.toString("base64"), filter: LOCAL_UNIT_BLUE },
  );

  if (sample.cx === null || sample.cy === null || sample.count < 20) {
    throw new Error(`local unit pixels not found on canvas (count=${sample.count})`);
  }

  return {
    x: (sample.cx * box.width) / sample.width,
    y: (sample.cy * box.height) / sample.height,
  };
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
