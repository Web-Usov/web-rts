/**
 * Declarative map definitions (Spec #002 §7.2–7.3). Runtime grid, occupancy and
 * placement validation belong to simulation; this module only describes data.
 */

/** Game-wide spatial scale: 1 navigation cell = 1 simulation world unit. */
export const NAVIGATION_CELL_SIZE = 1;

export type WorldPoint = {
  readonly x: number;
  readonly y: number;
};

/** Integer grid cell; (0, 0) is the cell at the map origin corner. */
export type CellCoord = {
  readonly x: number;
  readonly y: number;
};

/** Cells `[x, x + width) × [y, y + height)`. */
export type CellRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Static terrain override. Cells outside every region are walkable and buildable. */
export type StaticTerrainRegion = CellRect & {
  readonly walkable: boolean;
  readonly buildable: boolean;
};

/** Spawn slot, indexed by order among players present at Start (not by playerId). */
export type PlayerSpawnDefinition = {
  readonly region: CellRect;
  readonly unitPosition: WorldPoint;
};

export const MAP_OBJECTIVE_TYPES = ["PROTECT"] as const;
export type MapObjectiveType = (typeof MAP_OBJECTIVE_TYPES)[number];

/** Footprint entity placed at match start. `anchorCell` is the minimum-x/minimum-y cell. */
export type MapPlacement = {
  readonly definitionId: string;
  readonly anchorCell: CellCoord;
  /** Generic objective role assigned to the placed entity, if any. */
  readonly objective: { readonly type: MapObjectiveType; readonly required: boolean } | null;
};

export type MapDefinition = {
  readonly id: string;
  readonly originX: number;
  readonly originY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly staticTerrain: readonly StaticTerrainRegion[];
  readonly playerSpawns: readonly PlayerSpawnDefinition[];
  readonly startingPlacements: readonly MapPlacement[];
  readonly resourcePlacements: readonly MapPlacement[];
};

/** Half-open playable area `[minX, maxX) × [minY, maxY)` in world units. */
export type MapWorldBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export function mapWorldBounds(map: MapDefinition): MapWorldBounds {
  return {
    minX: map.originX,
    maxX: map.originX + map.widthCells * NAVIGATION_CELL_SIZE,
    minY: map.originY,
    maxY: map.originY + map.heightCells * NAVIGATION_CELL_SIZE,
  };
}

export const FOUNDATION_MAP_ID = "foundation";

/** 40×40 cells centered on world (0, 0). Layout matches the Foundation slice. */
export const FOUNDATION_MAP: MapDefinition = {
  id: FOUNDATION_MAP_ID,
  originX: -20,
  originY: -20,
  widthCells: 40,
  heightCells: 40,
  staticTerrain: [],
  playerSpawns: [
    { region: { x: 12, y: 15, width: 4, height: 4 }, unitPosition: { x: -6, y: -3 } },
    { region: { x: 24, y: 15, width: 4, height: 4 }, unitPosition: { x: 6, y: -3 } },
    { region: { x: 12, y: 24, width: 4, height: 4 }, unitPosition: { x: -6, y: 6 } },
    { region: { x: 24, y: 24, width: 4, height: 4 }, unitPosition: { x: 6, y: 6 } },
  ],
  startingPlacements: [
    {
      definitionId: "sacred_site",
      anchorCell: { x: 19, y: 19 },
      objective: { type: "PROTECT", required: true },
    },
  ],
  resourcePlacements: [],
};

const MAP_DEFINITIONS: ReadonlyMap<string, MapDefinition> = new Map([
  [FOUNDATION_MAP.id, FOUNDATION_MAP],
]);

export function getMapDefinition(mapId: string): MapDefinition | undefined {
  return MAP_DEFINITIONS.get(mapId);
}
