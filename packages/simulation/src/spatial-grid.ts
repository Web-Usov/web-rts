import {
  NAVIGATION_CELL_SIZE,
  mapWorldBounds,
  type CellCoord,
  type MapDefinition,
} from "@web-rts/game-data";
import type { EntityId, MapBounds, Vec2 } from "./types.js";

/**
 * Generic solid footprint (Spec #002 §7.4). `anchorCell` is the minimum-x/minimum-y
 * cell; the footprint covers `[anchor.x, anchor.x + width) × [anchor.y, anchor.y + height)`.
 */
export interface SpatialFootprint {
  readonly anchorCell: CellCoord;
  readonly width: number;
  readonly height: number;
  readonly blocksMovement: boolean;
  readonly blocksBuilding: boolean;
}

export type FootprintPlacementRefusal = "invalid_size" | "out_of_bounds" | "terrain" | "occupied";

export type FootprintPlacement =
  { readonly ok: true } | { readonly ok: false; readonly reason: FootprintPlacementRefusal };

const WALKABLE = 1;
const BUILDABLE = 2;
const NO_OCCUPANT = 0;

/** `floor((world - origin) / cellSize)`; may lie outside the grid. `-0` is normalized to `0`. */
export function worldToCell(point: Vec2, originX: number, originY: number): CellCoord {
  return {
    x: Math.floor((point.x - originX) / NAVIGATION_CELL_SIZE) + 0,
    y: Math.floor((point.y - originY) / NAVIGATION_CELL_SIZE) + 0,
  };
}

/** `origin + (cell + 0.5) * cellSize`. */
export function cellToWorldCenter(cell: CellCoord, originX: number, originY: number): Vec2 {
  return {
    x: originX + (cell.x + 0.5) * NAVIGATION_CELL_SIZE,
    y: originY + (cell.y + 0.5) * NAVIGATION_CELL_SIZE,
  };
}

/** World-space center of a footprint (where its entity Position lives). */
export function footprintWorldCenter(
  footprint: Pick<SpatialFootprint, "anchorCell" | "width" | "height">,
  originX: number,
  originY: number,
): Vec2 {
  return {
    x: originX + (footprint.anchorCell.x + footprint.width / 2) * NAVIGATION_CELL_SIZE,
    y: originY + (footprint.anchorCell.y + footprint.height / 2) * NAVIGATION_CELL_SIZE,
  };
}

/**
 * Runtime grid built from a declarative {@link MapDefinition}: static terrain flags
 * plus a dynamic solid-occupancy index. Units are never registered here (§7.5).
 */
export class SpatialGrid {
  readonly mapId: string;
  readonly originX: number;
  readonly originY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  /** Half-open `[min, max)` world bounds. */
  readonly bounds: MapBounds;

  private readonly terrain: Uint8Array;
  private readonly occupants: Uint32Array;
  private readonly footprints = new Map<EntityId, SpatialFootprint>();
  private revision = 0;

  constructor(map: MapDefinition) {
    if (
      !Number.isInteger(map.widthCells) ||
      !Number.isInteger(map.heightCells) ||
      map.widthCells <= 0 ||
      map.heightCells <= 0
    ) {
      throw new RangeError(`map ${map.id} must have positive integer cell dimensions`);
    }
    this.mapId = map.id;
    this.originX = map.originX;
    this.originY = map.originY;
    this.widthCells = map.widthCells;
    this.heightCells = map.heightCells;
    this.bounds = mapWorldBounds(map);
    const cellCount = map.widthCells * map.heightCells;
    this.terrain = new Uint8Array(cellCount).fill(WALKABLE | BUILDABLE);
    this.occupants = new Uint32Array(cellCount);
    for (const region of map.staticTerrain) {
      const flags = (region.walkable ? WALKABLE : 0) | (region.buildable ? BUILDABLE : 0);
      for (let y = region.y; y < region.y + region.height; y += 1) {
        for (let x = region.x; x < region.x + region.width; x += 1) {
          const cell = { x, y };
          if (!this.isCellInBounds(cell)) {
            throw new RangeError(`map ${map.id} terrain region leaves the grid at ${x},${y}`);
          }
          this.terrain[this.cellId(cell)] = flags;
        }
      }
    }
  }

  /** Increments only when solid topology actually changes. Not part of the wire view. */
  get topologyRevision(): number {
    return this.revision;
  }

  containsWorldPoint(point: Vec2): boolean {
    return (
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= this.bounds.minX &&
      point.x < this.bounds.maxX &&
      point.y >= this.bounds.minY &&
      point.y < this.bounds.maxY
    );
  }

  worldToCell(point: Vec2): CellCoord {
    return worldToCell(point, this.originX, this.originY);
  }

  cellToWorldCenter(cell: CellCoord): Vec2 {
    return cellToWorldCenter(cell, this.originX, this.originY);
  }

  footprintWorldCenter(footprint: SpatialFootprint): Vec2 {
    return footprintWorldCenter(footprint, this.originX, this.originY);
  }

  isCellInBounds(cell: CellCoord): boolean {
    return (
      Number.isInteger(cell.x) &&
      Number.isInteger(cell.y) &&
      cell.x >= 0 &&
      cell.y >= 0 &&
      cell.x < this.widthCells &&
      cell.y < this.heightCells
    );
  }

  /** Stable row-major id (ADR-008). Caller must pass an in-bounds cell. */
  cellId(cell: CellCoord): number {
    return cell.y * this.widthCells + cell.x;
  }

  isStaticWalkable(cell: CellCoord): boolean {
    return this.isCellInBounds(cell) && (this.terrain[this.cellId(cell)]! & WALKABLE) !== 0;
  }

  isStaticBuildable(cell: CellCoord): boolean {
    return this.isCellInBounds(cell) && (this.terrain[this.cellId(cell)]! & BUILDABLE) !== 0;
  }

  /** Solid occupant of the cell, or `null`. */
  occupantAt(cell: CellCoord): EntityId | null {
    if (!this.isCellInBounds(cell)) {
      return null;
    }
    const occupant = this.occupants[this.cellId(cell)]!;
    return occupant === NO_OCCUPANT ? null : occupant;
  }

  /** Navigation query: static terrain and movement-blocking footprints. Units never block. */
  isWalkable(cell: CellCoord): boolean {
    if (!this.isStaticWalkable(cell)) {
      return false;
    }
    const occupant = this.occupantAt(cell);
    return occupant === null || !this.footprints.get(occupant)!.blocksMovement;
  }

  /** Buildability query: static terrain and building-blocking footprints. */
  isBuildable(cell: CellCoord): boolean {
    if (!this.isStaticBuildable(cell)) {
      return false;
    }
    const occupant = this.occupantAt(cell);
    return occupant === null || !this.footprints.get(occupant)!.blocksBuilding;
  }

  /** Row-major cells covered by the footprint; empty for an invalid size. */
  footprintCells(
    footprint: Pick<SpatialFootprint, "anchorCell" | "width" | "height">,
  ): CellCoord[] {
    if (!isValidFootprintSize(footprint)) {
      return [];
    }
    const cells: CellCoord[] = [];
    const { anchorCell, width, height } = footprint;
    for (let y = anchorCell.y; y < anchorCell.y + height; y += 1) {
      for (let x = anchorCell.x; x < anchorCell.x + width; x += 1) {
        cells.push({ x, y });
      }
    }
    return cells;
  }

  /**
   * Whether a new solid footprint fits: every cell in bounds, statically buildable
   * and free of any solid occupant. Unit positions are checked by the World.
   */
  canPlaceFootprint(footprint: SpatialFootprint): FootprintPlacement {
    if (!isValidFootprintSize(footprint)) {
      return { ok: false, reason: "invalid_size" };
    }
    const cells = this.footprintCells(footprint);
    if (!cells.every((cell) => this.isCellInBounds(cell))) {
      return { ok: false, reason: "out_of_bounds" };
    }
    if (!cells.every((cell) => this.isStaticBuildable(cell))) {
      return { ok: false, reason: "terrain" };
    }
    if (cells.some((cell) => this.occupantAt(cell) !== null)) {
      return { ok: false, reason: "occupied" };
    }
    return { ok: true };
  }

  footprintOf(entityId: EntityId): SpatialFootprint | undefined {
    return this.footprints.get(entityId);
  }

  /** Registers a solid footprint and bumps {@link topologyRevision} once on success. */
  addFootprint(entityId: EntityId, footprint: SpatialFootprint): FootprintPlacement {
    if (this.footprints.has(entityId)) {
      return { ok: false, reason: "occupied" };
    }
    const placement = this.canPlaceFootprint(footprint);
    if (!placement.ok) {
      return placement;
    }
    const stored: SpatialFootprint = {
      anchorCell: { x: footprint.anchorCell.x, y: footprint.anchorCell.y },
      width: footprint.width,
      height: footprint.height,
      blocksMovement: footprint.blocksMovement,
      blocksBuilding: footprint.blocksBuilding,
    };
    for (const cell of this.footprintCells(stored)) {
      this.occupants[this.cellId(cell)] = entityId;
    }
    this.footprints.set(entityId, stored);
    this.revision += 1;
    return placement;
  }

  /** Removes a registered footprint. Unknown entity is a no-op and keeps the revision. */
  removeFootprint(entityId: EntityId): boolean {
    const footprint = this.footprints.get(entityId);
    if (footprint === undefined) {
      return false;
    }
    for (const cell of this.footprintCells(footprint)) {
      this.occupants[this.cellId(cell)] = NO_OCCUPANT;
    }
    this.footprints.delete(entityId);
    this.revision += 1;
    return true;
  }
}

function isValidFootprintSize(
  footprint: Pick<SpatialFootprint, "anchorCell" | "width" | "height">,
): boolean {
  return (
    Number.isInteger(footprint.width) &&
    Number.isInteger(footprint.height) &&
    footprint.width > 0 &&
    footprint.height > 0 &&
    Number.isInteger(footprint.anchorCell.x) &&
    Number.isInteger(footprint.anchorCell.y)
  );
}
