/** Foundation map data plus the shared placement and MOVE gate that apply it. */
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

export {
  assessFoundationMove,
  placeFoundationObjective,
  spawnFoundationUnits,
  type FoundationMoveDecision,
  type FoundationMoveRefusal,
} from "./foundation-match.js";
