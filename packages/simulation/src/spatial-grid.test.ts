import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP, type MapDefinition } from "@web-rts/game-data";
import {
  SpatialGrid,
  cellToWorldCenter,
  worldToCell,
  type SpatialFootprint,
} from "./spatial-grid.js";

const SMALL_MAP: MapDefinition = {
  id: "test-small",
  originX: -4,
  originY: 2,
  widthCells: 8,
  heightCells: 6,
  staticTerrain: [
    { x: 0, y: 0, width: 2, height: 1, walkable: false, buildable: false },
    { x: 5, y: 3, width: 1, height: 2, walkable: true, buildable: false },
  ],
  playerSpawns: [],
  startingPlacements: [],
  resourcePlacements: [],
};

function solid(x: number, y: number, width = 1, height = 1): SpatialFootprint {
  return { anchorCell: { x, y }, width, height, blocksMovement: true, blocksBuilding: true };
}

describe("world ↔ cell conversion", () => {
  it("uses floor((world - origin) / cellSize) with exact boundaries", () => {
    expect(worldToCell({ x: -4, y: 2 }, -4, 2)).toEqual({ x: 0, y: 0 });
    expect(worldToCell({ x: -3.000001, y: 2.999999 }, -4, 2)).toEqual({ x: 0, y: 0 });
    expect(worldToCell({ x: -3, y: 3 }, -4, 2)).toEqual({ x: 1, y: 1 });
    expect(worldToCell({ x: 4, y: 8 }, -4, 2)).toEqual({ x: 8, y: 6 });
  });

  it("floors negative and fractional coordinates toward -infinity", () => {
    expect(worldToCell({ x: -0.5, y: -0.25 }, 0, 0)).toEqual({ x: -1, y: -1 });
    expect(worldToCell({ x: -1, y: -1.5 }, 0, 0)).toEqual({ x: -1, y: -2 });
    expect(worldToCell({ x: 0.999, y: 1.5 }, 0, 0)).toEqual({ x: 0, y: 1 });
  });

  it("normalizes -0 to 0", () => {
    const cell = worldToCell({ x: -0, y: -0 }, 0, 0);
    expect(Object.is(cell.x, 0)).toBe(true);
    expect(Object.is(cell.y, 0)).toBe(true);
  });

  it("maps cells to their world centers and back", () => {
    expect(cellToWorldCenter({ x: 0, y: 0 }, -20, -20)).toEqual({ x: -19.5, y: -19.5 });
    expect(cellToWorldCenter({ x: 39, y: 20 }, -20, -20)).toEqual({ x: 19.5, y: 0.5 });
    for (const cell of [
      { x: 0, y: 0 },
      { x: 7, y: 5 },
      { x: 3, y: 2 },
    ]) {
      expect(worldToCell(cellToWorldCenter(cell, -4, 2), -4, 2)).toEqual(cell);
    }
  });
});

describe("SpatialGrid bounds", () => {
  const grid = new SpatialGrid(SMALL_MAP);

  it("derives half-open world bounds from the MapDefinition", () => {
    expect(grid.bounds).toEqual({ minX: -4, maxX: 4, minY: 2, maxY: 8 });
    expect(new SpatialGrid(FOUNDATION_MAP).bounds).toEqual({
      minX: -20,
      maxX: 20,
      minY: -20,
      maxY: 20,
    });
  });

  it("includes min and excludes max", () => {
    expect(grid.containsWorldPoint({ x: -4, y: 2 })).toBe(true);
    expect(grid.containsWorldPoint({ x: 3.999, y: 7.999 })).toBe(true);
    expect(grid.containsWorldPoint({ x: 4, y: 5 })).toBe(false);
    expect(grid.containsWorldPoint({ x: 0, y: 8 })).toBe(false);
    expect(grid.containsWorldPoint({ x: -4.001, y: 5 })).toBe(false);
    expect(grid.containsWorldPoint({ x: 0, y: 1.999 })).toBe(false);
  });

  it("rejects non-finite points", () => {
    expect(grid.containsWorldPoint({ x: Number.NaN, y: 5 })).toBe(false);
    expect(grid.containsWorldPoint({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("keeps every in-bounds world point inside an in-bounds cell", () => {
    for (const point of [
      { x: -4, y: 2 },
      { x: 3.999999, y: 7.999999 },
      { x: 0, y: 5 },
    ]) {
      expect(grid.containsWorldPoint(point)).toBe(true);
      expect(grid.isCellInBounds(grid.worldToCell(point))).toBe(true);
    }
    expect(grid.isCellInBounds(grid.worldToCell({ x: 4, y: 8 }))).toBe(false);
  });

  it("checks cell bounds and uses stable row-major ids", () => {
    expect(grid.isCellInBounds({ x: 0, y: 0 })).toBe(true);
    expect(grid.isCellInBounds({ x: 7, y: 5 })).toBe(true);
    expect(grid.isCellInBounds({ x: 8, y: 0 })).toBe(false);
    expect(grid.isCellInBounds({ x: 0, y: 6 })).toBe(false);
    expect(grid.isCellInBounds({ x: -1, y: 0 })).toBe(false);
    expect(grid.isCellInBounds({ x: 0.5, y: 0 })).toBe(false);
    expect(grid.cellId({ x: 0, y: 0 })).toBe(0);
    expect(grid.cellId({ x: 7, y: 0 })).toBe(7);
    expect(grid.cellId({ x: 0, y: 1 })).toBe(8);
    expect(grid.cellId({ x: 7, y: 5 })).toBe(47);
  });

  it("rejects maps without positive integer dimensions", () => {
    expect(() => new SpatialGrid({ ...SMALL_MAP, widthCells: 0 })).toThrow(RangeError);
    expect(() => new SpatialGrid({ ...SMALL_MAP, heightCells: 2.5 })).toThrow(RangeError);
  });

  it("rejects static terrain regions outside the grid", () => {
    expect(
      () =>
        new SpatialGrid({
          ...SMALL_MAP,
          staticTerrain: [{ x: 7, y: 0, width: 2, height: 1, walkable: false, buildable: false }],
        }),
    ).toThrow(RangeError);
  });
});

describe("static terrain vs dynamic occupancy", () => {
  it("reads static walkability/buildability from the MapDefinition", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.isStaticWalkable({ x: 0, y: 0 })).toBe(false);
    expect(grid.isStaticBuildable({ x: 1, y: 0 })).toBe(false);
    expect(grid.isStaticWalkable({ x: 5, y: 3 })).toBe(true);
    expect(grid.isStaticBuildable({ x: 5, y: 4 })).toBe(false);
    expect(grid.isStaticWalkable({ x: 2, y: 0 })).toBe(true);
    expect(grid.isStaticBuildable({ x: 2, y: 0 })).toBe(true);
    expect(grid.isWalkable({ x: 8, y: 0 })).toBe(false);
    expect(grid.isBuildable({ x: -1, y: 0 })).toBe(false);
  });

  it("keeps static terrain flags when solid footprints come and go", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.addFootprint(7, solid(4, 3)).ok).toBe(true);
    expect(grid.isWalkable({ x: 4, y: 3 })).toBe(false);
    expect(grid.isStaticWalkable({ x: 4, y: 3 })).toBe(true);
    expect(grid.removeFootprint(7)).toBe(true);
    expect(grid.isWalkable({ x: 4, y: 3 })).toBe(true);
    expect(grid.isStaticWalkable({ x: 0, y: 0 })).toBe(false);
  });

  it("separates movement and building blockers", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    grid.addFootprint(3, {
      anchorCell: { x: 2, y: 2 },
      width: 1,
      height: 1,
      blocksMovement: false,
      blocksBuilding: true,
    });
    expect(grid.occupantAt({ x: 2, y: 2 })).toBe(3);
    expect(grid.isWalkable({ x: 2, y: 2 })).toBe(true);
    expect(grid.isBuildable({ x: 2, y: 2 })).toBe(false);
  });
});

describe("footprint placement", () => {
  it("covers width × height cells from the minimum-corner anchor in row-major order", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.footprintCells(solid(2, 3, 3, 2))).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
    expect(grid.footprintWorldCenter(solid(2, 3, 3, 2))).toEqual({ x: -0.5, y: 6 });
  });

  it("accepts a multi-cell footprint on free buildable cells", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.canPlaceFootprint(solid(2, 1, 3, 2))).toEqual({ ok: true });
    expect(grid.addFootprint(5, solid(2, 1, 3, 2))).toEqual({ ok: true });
    for (const cell of grid.footprintCells(solid(2, 1, 3, 2))) {
      expect(grid.occupantAt(cell)).toBe(5);
    }
    expect(grid.footprintOf(5)).toEqual(solid(2, 1, 3, 2));
  });

  it("rejects overlap with an existing footprint, including partial multi-cell overlap", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    grid.addFootprint(5, solid(2, 1, 2, 2));
    expect(grid.canPlaceFootprint(solid(3, 2, 2, 2))).toEqual({ ok: false, reason: "occupied" });
    expect(grid.canPlaceFootprint(solid(2, 1))).toEqual({ ok: false, reason: "occupied" });
    expect(grid.canPlaceFootprint(solid(4, 1, 2, 2))).toEqual({ ok: true });
    expect(grid.addFootprint(6, solid(3, 2))).toEqual({ ok: false, reason: "occupied" });
    expect(grid.occupantAt({ x: 3, y: 2 })).toBe(5);
  });

  it("rejects footprints that leave the grid on any side", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.canPlaceFootprint(solid(7, 0, 2, 1))).toEqual({
      ok: false,
      reason: "out_of_bounds",
    });
    expect(grid.canPlaceFootprint(solid(0, 5, 1, 2))).toEqual({
      ok: false,
      reason: "out_of_bounds",
    });
    expect(grid.canPlaceFootprint(solid(-1, 2, 2, 1))).toEqual({
      ok: false,
      reason: "out_of_bounds",
    });
    expect(grid.canPlaceFootprint(solid(6, 4, 2, 2))).toEqual({ ok: true });
  });

  it("rejects footprints over static non-buildable terrain", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.canPlaceFootprint(solid(1, 0, 2, 2))).toEqual({ ok: false, reason: "terrain" });
    expect(grid.canPlaceFootprint(solid(5, 4))).toEqual({ ok: false, reason: "terrain" });
  });

  it("rejects invalid sizes and fractional anchors", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.canPlaceFootprint(solid(2, 2, 0, 1))).toEqual({
      ok: false,
      reason: "invalid_size",
    });
    expect(grid.canPlaceFootprint(solid(2, 2, 1.5, 1))).toEqual({
      ok: false,
      reason: "invalid_size",
    });
    expect(grid.canPlaceFootprint(solid(2.5, 2))).toEqual({ ok: false, reason: "invalid_size" });
    expect(grid.footprintCells(solid(2, 2, -1, 1))).toEqual([]);
  });
});

describe("topologyRevision", () => {
  it("starts at 0 and increments once per solid add/remove", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    expect(grid.topologyRevision).toBe(0);
    grid.addFootprint(1, solid(2, 1, 2, 2));
    expect(grid.topologyRevision).toBe(1);
    grid.addFootprint(2, solid(6, 4));
    expect(grid.topologyRevision).toBe(2);
    grid.removeFootprint(1);
    expect(grid.topologyRevision).toBe(3);
  });

  it("does not change on rejected placement, unknown removal or queries", () => {
    const grid = new SpatialGrid(SMALL_MAP);
    grid.addFootprint(1, solid(2, 1));
    const before = grid.topologyRevision;

    expect(grid.addFootprint(2, solid(2, 1)).ok).toBe(false);
    expect(grid.addFootprint(1, solid(4, 4)).ok).toBe(false);
    expect(grid.addFootprint(3, solid(7, 5, 2, 1)).ok).toBe(false);
    expect(grid.addFootprint(4, solid(0, 0)).ok).toBe(false);
    expect(grid.removeFootprint(99)).toBe(false);
    grid.canPlaceFootprint(solid(3, 3));
    grid.isWalkable({ x: 2, y: 1 });

    expect(grid.topologyRevision).toBe(before);
    grid.removeFootprint(1);
    expect(grid.removeFootprint(1)).toBe(false);
    expect(grid.topologyRevision).toBe(before + 1);
  });
});
