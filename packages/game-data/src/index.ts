/** Declarative game-data: entity definitions, map definitions and spatial constants. */
export const packageName = "@web-rts/game-data" as const;

export {
  RESOURCE_TYPES,
  RESOURCE_DEFINITIONS,
  type ResourceType,
  ENTITY_DEFINITIONS,
  ENTITY_KINDS,
  getEntityDefinition,
  type EntityDefinition,
  type EntityDefinitionId,
  type EntityKind,
  type FootprintDefinition,
} from "./entity-definitions.js";
export {
  FOUNDATION_MAP,
  FOUNDATION_MAP_ID,
  MAP_OBJECTIVE_TYPES,
  NAVIGATION_CELL_SIZE,
  getMapDefinition,
  mapWorldBounds,
  type CellCoord,
  type CellRect,
  type MapDefinition,
  type MapObjectiveType,
  type MapPlacement,
  type MapWorldBounds,
  type PlayerSpawnDefinition,
  type StaticTerrainRegion,
  type WorldPoint,
} from "./map-definition.js";
