import type { MapDefinition } from "@web-rts/game-data";
import { describe, expect, it } from "vitest";
import { NEIGHBOR_OFFSETS, approachGoalCells, findPath, type WalkGrid } from "./navigation.js";
import { SpatialGrid, type SpatialFootprint } from "./spatial-grid.js";

function testMap(
  width: number,
  height: number,
  staticTerrain: MapDefinition["staticTerrain"] = [],
): MapDefinition {
  return {
    id: "nav-test",
    originX: 0,
    originY: 0,
    widthCells: width,
    heightCells: height,
    staticTerrain,
    playerSpawns: [],
    startingPlacements: [],
    resourcePlacements: [],
  };
}

function solid(x: number, y: number, width = 1, height = 1): SpatialFootprint {
  return { anchorCell: { x, y }, width, height, blocksMovement: true, blocksBuilding: true };
}

function assertOrthogonal(cells: readonly { x: number; y: number }[]): void {
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
  }
}

describe("deterministic A*", () => {
  it("keeps a fixed 4-neighbour offset order", () => {
    expect(NEIGHBOR_OFFSETS).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ]);
  });

  it("enumerates neighbours in that order while searching", () => {
    const grid = new SpatialGrid(testMap(5, 5));
    const calls: string[] = [];
    const wrapped: WalkGrid = {
      widthCells: grid.widthCells,
      heightCells: grid.heightCells,
      isCellInBounds: (cell) => grid.isCellInBounds(cell),
      cellId: (cell) => grid.cellId(cell),
      isWalkable: (cell) => {
        calls.push(`${cell.x},${cell.y}`);
        return grid.isWalkable(cell);
      },
    };

    findPath(wrapped, { x: 2, y: 2 }, [{ x: 4, y: 2 }]);

    expect(calls.slice(0, 6)).toEqual(["2,2", "4,2", "3,2", "2,3", "1,2", "2,1"]);
  });

  it("routes on 4-neighbour steps and stays on the map edge", () => {
    const grid = new SpatialGrid(testMap(4, 4));
    const diagonal = findPath(grid, { x: 0, y: 0 }, [{ x: 1, y: 1 }]);
    const edge = findPath(grid, { x: 0, y: 0 }, [{ x: 0, y: 3 }]);

    expect(diagonal).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(edge).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ]);
    assertOrthogonal(diagonal!);
    assertOrthogonal(edge!);
  });

  it("avoids static non-walkable cells and generic solid footprints", () => {
    const terrain = new SpatialGrid(
      testMap(5, 3, [{ x: 2, y: 1, width: 1, height: 1, walkable: false, buildable: false }]),
    );
    const aroundTerrain = findPath(terrain, { x: 1, y: 1 }, [{ x: 3, y: 1 }]);
    expect(aroundTerrain).not.toContainEqual({ x: 2, y: 1 });
    assertOrthogonal(aroundTerrain!);

    const grid = new SpatialGrid(testMap(5, 3));
    const blocker = 7;
    expect(grid.addFootprint(blocker, solid(2, 1))).toEqual({ ok: true });
    const aroundSolid = findPath(grid, { x: 1, y: 1 }, [{ x: 3, y: 1 }]);
    expect(aroundSolid).toEqual(aroundTerrain);
    expect(aroundSolid).not.toContainEqual({ x: 2, y: 1 });

    const open = new SpatialGrid(testMap(5, 3));
    open.addFootprint(blocker, { ...solid(2, 1), blocksMovement: false });
    expect(findPath(open, { x: 1, y: 1 }, [{ x: 3, y: 1 }])).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
  });

  it("repeats the same cells for the same topology, start and goals", () => {
    const grid = new SpatialGrid(testMap(6, 4));
    grid.addFootprint(1, solid(2, 1, 2, 2));
    const goals = approachGoalCells(grid, solid(2, 1, 2, 2));
    const first = findPath(grid, { x: 0, y: 0 }, goals);
    const second = findPath(grid, { x: 0, y: 0 }, goals);
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
  });

  it("breaks equal-cost paths by f, then h, then cellId", () => {
    const grid = new SpatialGrid(testMap(5, 3));
    grid.addFootprint(1, solid(2, 1));

    // East of the start is blocked. +y is the first open neighbour offset, but the
    // south cell has the smaller cellId, so the open-set order steps south.
    expect(findPath(grid, { x: 1, y: 1 }, [{ x: 3, y: 1 }])).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ]);
  });

  it("selects one deterministic goal from a set", () => {
    const grid = new SpatialGrid(testMap(5, 5));

    expect(
      findPath(grid, { x: 0, y: 0 }, [
        { x: 3, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect(
      findPath(grid, { x: 1, y: 1 }, [
        { x: 1, y: 2 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);
  });

  it("returns null when every goal is unreachable", () => {
    const grid = new SpatialGrid(testMap(5, 3));
    for (let y = 0; y < 3; y += 1) {
      grid.addFootprint(y + 1, solid(2, y));
    }
    expect(findPath(grid, { x: 0, y: 1 }, [{ x: 4, y: 1 }])).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, [])).toBeNull();
  });
});

describe("approach goals", () => {
  it("returns the walkable ring in row-major order", () => {
    const grid = new SpatialGrid(testMap(8, 8));
    expect(approachGoalCells(grid, solid(2, 2, 2, 2))).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 1, y: 3 },
      { x: 4, y: 3 },
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
  });

  it("drops out-of-bounds and non-walkable cells around a boundary footprint", () => {
    const grid = new SpatialGrid(
      testMap(4, 4, [{ x: 2, y: 0, width: 1, height: 1, walkable: false, buildable: false }]),
    );
    expect(approachGoalCells(grid, solid(0, 0, 2, 2))).toEqual([
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it("paths to the deterministic approach cell of an occupied footprint", () => {
    const grid = new SpatialGrid(testMap(6, 6));
    const footprint = solid(2, 2, 2, 2);
    grid.addFootprint(1, footprint);
    const goals = approachGoalCells(grid, footprint);
    expect(findPath(grid, { x: 0, y: 0 }, goals)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});
