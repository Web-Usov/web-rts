import { describe, expect, it } from "vitest";
import {
  buildTickDiagnostic,
  isVerboseTickLoggingEnabled,
  measureStepDuration,
} from "./tick-diagnostics.js";

describe("tick diagnostics", () => {
  it("reads the process clock without detaching Performance", () => {
    const durationMs = measureStepDuration(() => {});
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(durationMs)).toBe(true);
  });

  it("measures duration around the step with an injected clock", () => {
    let calls = 0;
    const now = (): number => {
      calls += 1;
      return calls === 1 ? 10 : 12.5;
    };
    let stepped = false;
    const durationMs = measureStepDuration(() => {
      stepped = true;
    }, now);

    expect(stepped).toBe(true);
    expect(durationMs).toBe(2.5);
  });

  it("records tick, duration, entity count, and pending commands", () => {
    const diagnostic = buildTickDiagnostic({
      step: () => {},
      now: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          return calls === 1 ? 0 : 4;
        };
      })(),
      tick: () => 8,
      entityCount: () => 3,
      pendingCommandCount: () => 1,
    });

    expect(diagnostic).toEqual({
      tick: 8,
      durationMs: 4,
      entityCount: 3,
      pendingCommandCount: 1,
    });
  });

  it("disables verbose per-tick logs in production, test, and CI unless forced", () => {
    expect(isVerboseTickLoggingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isVerboseTickLoggingEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isVerboseTickLoggingEnabled({ CI: "true" })).toBe(false);
    expect(isVerboseTickLoggingEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isVerboseTickLoggingEnabled({})).toBe(true);
    expect(isVerboseTickLoggingEnabled({ NODE_ENV: "production", TICK_DIAGNOSTICS_LOG: "1" })).toBe(
      true,
    );
    expect(
      isVerboseTickLoggingEnabled({ NODE_ENV: "development", TICK_DIAGNOSTICS_LOG: "0" }),
    ).toBe(false);
  });
});
