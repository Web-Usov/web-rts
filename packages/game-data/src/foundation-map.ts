/**
 * Foundation map bounds and spawn layout for the vertical slice.
 * Application/game-data boundary — not simulation core rules.
 */

/** Half-extent of the axis-aligned foundation playable square on simulation (x, y). */
export const FOUNDATION_MAP_HALF_EXTENT = 20;

export type FoundationMapBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export const FOUNDATION_MAP_BOUNDS: FoundationMapBounds = {
  minX: -FOUNDATION_MAP_HALF_EXTENT,
  maxX: FOUNDATION_MAP_HALF_EXTENT,
  minY: -FOUNDATION_MAP_HALF_EXTENT,
  maxY: FOUNDATION_MAP_HALF_EXTENT,
};

export type GroundPoint = {
  readonly x: number;
  readonly y: number;
};

/** Inclusive AABB check for MOVE targets and spawn placement. */
export function isWithinFoundationBounds(
  point: GroundPoint,
  bounds: FoundationMapBounds = FOUNDATION_MAP_BOUNDS,
): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Distinct start positions for the current foundation match.
 * Indexed by spawn slot among players present at Start, not by historical playerId.
 * playerId 4 after a leave/replace must not wrap onto slot 0.
 */
export const FOUNDATION_UNIT_SPAWN_POSITIONS: readonly GroundPoint[] = [
  { x: -6, y: -3 },
  { x: 6, y: -3 },
  { x: -6, y: 6 },
  { x: 6, y: 6 },
];

export function foundationUnitSpawnPosition(spawnIndex: number): GroundPoint {
  const point = FOUNDATION_UNIT_SPAWN_POSITIONS[spawnIndex];
  if (point === undefined) {
    throw new RangeError(`foundation spawn index out of range: ${spawnIndex}`);
  }
  return point;
}
