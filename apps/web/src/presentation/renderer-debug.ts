/** Public renderer counters copied off the Babylon frame. Not a network or simulation type. */
export type RendererDebugSample = {
  readonly fps: number;
  readonly drawCalls: number;
  readonly activeMeshes: number;
  readonly frameTimeMs: number;
};

export const EMPTY_RENDERER_DEBUG_SAMPLE: RendererDebugSample = {
  fps: 0,
  drawCalls: 0,
  activeMeshes: 0,
  frameTimeMs: 0,
};

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

/** Normalizes a frame's public counters. Invalid readings become 0 so the overlay stays numeric. */
export function snapshotRendererDebugSample(input: RendererDebugSample): RendererDebugSample {
  return {
    fps: finiteNonNegative(input.fps),
    drawCalls: finiteNonNegative(input.drawCalls),
    activeMeshes: finiteNonNegative(input.activeMeshes),
    frameTimeMs: finiteNonNegative(input.frameTimeMs),
  };
}
