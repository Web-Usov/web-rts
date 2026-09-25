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
 * Distinct start positions for foundation primitive units (player slot order).
 * Indexed by server-assigned playerId; outside simulation ownership model.
 */
export const FOUNDATION_UNIT_SPAWN_POSITIONS: readonly GroundPoint[] = [
  { x: -6, y: -3 },
  { x: 6, y: -3 },
  { x: -6, y: 6 },
  { x: 6, y: 6 },
];

export function foundationUnitSpawnPosition(playerId: number): GroundPoint {
  const index =
    ((playerId % FOUNDATION_UNIT_SPAWN_POSITIONS.length) + FOUNDATION_UNIT_SPAWN_POSITIONS.length) %
    FOUNDATION_UNIT_SPAWN_POSITIONS.length;
  return FOUNDATION_UNIT_SPAWN_POSITIONS[index]!;
}
