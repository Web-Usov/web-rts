import type { MapDefinition } from "@web-rts/game-data";

/** Default simulation tick rate (ADR-004). */
export const DEFAULT_TICK_HZ = 10;

/** Default unit movement speed in world units per second. */
export const DEFAULT_MOVE_SPEED = 5;

export interface PathQueryBudgets {
  readonly commandBudget: number;
  readonly activeTaskBudget: number;
  readonly aiBudget: number;
}

/** Query-count limits, not a CPU-time guarantee; see docs/verification/68-g4b. */
export const DEFAULT_PATH_QUERY_BUDGETS: PathQueryBudgets = {
  commandBudget: 16,
  activeTaskBudget: 8,
  aiBudget: 8,
};
export const DEFAULT_MAX_PATH_QUERIES_PER_TICK = 32;

export function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export interface SimulationConfig {
  readonly pathQueriesPerTick: PathQueryBudgets;
  readonly maxPathQueriesPerTick: number;
  readonly tickHz: number;
  /** Seconds of gameplay time advanced by one tick. */
  readonly tickDurationSeconds: number;
  readonly seed: number;
  readonly defaultMoveSpeed: number;
  /**
   * Declarative map for the runtime grid and half-open MOVE bounds.
   * `null` disables the grid and the bounds check (low-level kernel tests).
   */
  readonly map: MapDefinition | null;
}

export interface CreateWorldOptions {
  pathQueriesPerTick?: Partial<PathQueryBudgets>;
  maxPathQueriesPerTick?: number;
  seed?: number;
  tickHz?: number;
  defaultMoveSpeed?: number;
  map?: MapDefinition | null;
}

export function resolveSimulationConfig(options: CreateWorldOptions = {}): SimulationConfig {
  const tickHz = positiveInteger(options.tickHz ?? DEFAULT_TICK_HZ, "tickHz");
  const pathQueriesPerTick = { ...DEFAULT_PATH_QUERY_BUDGETS, ...options.pathQueriesPerTick };
  for (const [name, value] of Object.entries(pathQueriesPerTick)) positiveInteger(value, name);
  const maxPathQueriesPerTick = positiveInteger(
    options.maxPathQueriesPerTick ?? DEFAULT_MAX_PATH_QUERIES_PER_TICK,
    "maxPathQueriesPerTick",
  );
  const total =
    pathQueriesPerTick.commandBudget +
    pathQueriesPerTick.activeTaskBudget +
    pathQueriesPerTick.aiBudget;
  if (!Number.isSafeInteger(total) || total > maxPathQueriesPerTick) {
    throw new RangeError("path lane budgets must sum to <= maxPathQueriesPerTick");
  }
  return {
    pathQueriesPerTick,
    maxPathQueriesPerTick,
    tickHz,
    tickDurationSeconds: 1 / tickHz,
    seed: options.seed ?? 0,
    defaultMoveSpeed: options.defaultMoveSpeed ?? DEFAULT_MOVE_SPEED,
    map: options.map ?? null,
  };
}
