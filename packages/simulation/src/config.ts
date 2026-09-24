/** Default simulation tick rate (ADR-004). */
export const DEFAULT_TICK_HZ = 10;

/** Default unit movement speed in world units per second. */
export const DEFAULT_MOVE_SPEED = 5;

export interface SimulationConfig {
  readonly tickHz: number;
  /** Seconds of gameplay time advanced by one tick. */
  readonly tickDurationSeconds: number;
  readonly seed: number;
  readonly defaultMoveSpeed: number;
}

export interface CreateWorldOptions {
  seed?: number;
  tickHz?: number;
  defaultMoveSpeed?: number;
}

export function resolveSimulationConfig(options: CreateWorldOptions = {}): SimulationConfig {
  const tickHz = options.tickHz ?? DEFAULT_TICK_HZ;
  return {
    tickHz,
    tickDurationSeconds: 1 / tickHz,
    seed: options.seed ?? 0,
    defaultMoveSpeed: options.defaultMoveSpeed ?? DEFAULT_MOVE_SPEED,
  };
}
