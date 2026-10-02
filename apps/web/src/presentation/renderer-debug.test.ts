import { describe, expect, it } from "vitest";
import { snapshotRendererDebugSample } from "./renderer-debug.js";

describe("snapshotRendererDebugSample", () => {
  it("keeps finite non-negative renderer counters", () => {
    expect(
      snapshotRendererDebugSample({
        fps: 60,
        drawCalls: 12,
        activeMeshes: 4,
        frameTimeMs: 3.5,
      }),
    ).toEqual({
      fps: 60,
      drawCalls: 12,
      activeMeshes: 4,
      frameTimeMs: 3.5,
    });
  });

  it("drops non-finite readings instead of forwarding them to the overlay", () => {
    expect(
      snapshotRendererDebugSample({
        fps: Number.NaN,
        drawCalls: -1,
        activeMeshes: Number.POSITIVE_INFINITY,
        frameTimeMs: Number.NaN,
      }),
    ).toEqual({
      fps: 0,
      drawCalls: 0,
      activeMeshes: 0,
      frameTimeMs: 0,
    });
  });
});
