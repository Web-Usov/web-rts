import { describe, expect, it } from "vitest";
import {
  DEBUG_METRICS_INTERVAL_MS,
  formatDebugCount,
  formatFrameTimeMs,
  formatRoundTripLabel,
  isDebugInstrumentationEnabled,
} from "./debug-metrics.js";

describe("debug metrics", () => {
  it("follows the development flag and stays off for production builds", () => {
    expect(isDebugInstrumentationEnabled(true)).toBe(true);
    expect(isDebugInstrumentationEnabled(false)).toBe(false);
  });

  it("samples a few times per second instead of every frame", () => {
    expect(DEBUG_METRICS_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    expect(DEBUG_METRICS_INTERVAL_MS).toBeLessThanOrEqual(500);
  });

  it("formats counts and frame time without exact-FPS assumptions", () => {
    expect(formatDebugCount(59.4)).toBe("59");
    expect(formatDebugCount(0)).toBe("0");
    expect(formatDebugCount(Number.NaN)).toBe("—");
    expect(formatFrameTimeMs(4.26)).toBe("4.3");
    expect(formatFrameTimeMs(-1)).toBe("—");
  });

  it("shows unavailable RTT as an explicit label", () => {
    expect(formatRoundTripLabel(null)).toBe("unavailable");
    expect(formatRoundTripLabel(Number.POSITIVE_INFINITY)).toBe("unavailable");
    expect(formatRoundTripLabel(-2)).toBe("unavailable");
    expect(formatRoundTripLabel(0)).toBe("0");
    expect(formatRoundTripLabel(12.6)).toBe("13");
  });
});
