/** Compact numeric entity id (uint32-compatible). */
export type EntityId = number;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Position {
  x: number;
  y: number;
}

/** Movement intent: entity travels toward target at speed (units/sec). */
export interface Movement {
  targetX: number;
  targetY: number;
  speed: number;
}
