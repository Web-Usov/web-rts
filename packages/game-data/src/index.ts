/** Declarative game-data for foundation maps and spawn layout. */
export const packageName = "@web-rts/game-data" as const;

export {
  FOUNDATION_MAP_BOUNDS,
  FOUNDATION_MAP_HALF_EXTENT,
  FOUNDATION_OBJECTIVE_POSITION,
  FOUNDATION_UNIT_SPAWN_POSITIONS,
  foundationUnitSpawnPosition,
  isWithinFoundationBounds,
  type FoundationMapBounds,
  type GroundPoint,
} from "./foundation-map.js";
