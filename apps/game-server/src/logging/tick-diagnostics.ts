/**
 * Wall-clock measurement around SimulationHost.step().
 * The clock stays in the server/application boundary. packages/simulation does not see it.
 *
 * Verbose per-tick logs:
 * - `TICK_DIAGNOSTICS_LOG=1` forces them on, `0` forces them off;
 * - otherwise they are off for `NODE_ENV=production`, `NODE_ENV=test`, and CI;
 * - local development (unset NODE_ENV) logs them.
 * Docker sets `NODE_ENV=production`, so production does not emit a line per tick.
 * The in-memory diagnostic is still updated every tick.
 */
export type TickDiagnostic = {
  tick: number;
  durationMs: number;
  entityCount: number;
  pendingCommandCount: number;
};

export type TickLoggingEnv = {
  NODE_ENV?: string;
  CI?: string;
  TICK_DIAGNOSTICS_LOG?: string;
};

export function isVerboseTickLoggingEnabled(env: TickLoggingEnv = process.env): boolean {
  const flag = env.TICK_DIAGNOSTICS_LOG;
  if (flag === "0" || flag === "false") {
    return false;
  }
  if (flag === "1" || flag === "true") {
    return true;
  }
  if (env.NODE_ENV === "production" || env.NODE_ENV === "test") {
    return false;
  }
  if (env.CI === "true" || env.CI === "1") {
    return false;
  }
  return true;
}

/** Bound wrapper. Passing `performance.now` directly loses `this` inside the tick timer. */
const readWallClockMs = (): number => performance.now();

/** Elapsed milliseconds around one simulation step. `now` is injected so tests need no wall clock. */
export function measureStepDuration(step: () => void, now: () => number = readWallClockMs): number {
  const started = now();
  step();
  return now() - started;
}

export function buildTickDiagnostic(input: {
  step: () => void;
  now?: () => number;
  tick: () => number;
  entityCount: () => number;
  pendingCommandCount: () => number;
}): TickDiagnostic {
  const pendingCommandCount = input.pendingCommandCount();
  const durationMs = measureStepDuration(input.step, input.now ?? readWallClockMs);
  return {
    tick: input.tick(),
    durationMs,
    entityCount: input.entityCount(),
    pendingCommandCount,
  };
}
