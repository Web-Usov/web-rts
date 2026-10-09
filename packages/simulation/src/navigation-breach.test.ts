import type { CellCoord, MapDefinition } from "@web-rts/game-data";
import { describe, expect, it, vi } from "vitest";
import { findBreachPath, type BreachGrid, type BreachPathResult } from "./navigation-breach.js";
import { approachGoalCells, findPath } from "./navigation.js";
import { SpatialGrid } from "./spatial-grid.js";

const cell = (x: number, y: number): CellCoord => ({ x, y });
const allow: (entityId: number) => boolean = () => true;

/** ASCII maps use rectangular, real SpatialGrid footprints; # stays static. */
function map(rows: readonly string[], ids: Readonly<Record<string, number>> = {}): SpatialGrid {
  const staticTerrain: MapDefinition["staticTerrain"][number][] = [];
  const solids = new Map<string, CellCoord[]>();
  rows.forEach((row, y) => {
    expect(row.length).toBe(rows[0]!.length);
    [...row].forEach((symbol, x) => {
      if (symbol === "#") {
        // Static non-walkable but buildable permits terrain under a footprint.
        staticTerrain.push({ x, y, width: 1, height: 1, walkable: false, buildable: true });
      } else if (symbol !== ".") {
        const covered = solids.get(symbol) ?? [];
        covered.push(cell(x, y));
        solids.set(symbol, covered);
      }
    });
  });
  const grid = new SpatialGrid({
    id: "breach-test",
    originX: 0,
    originY: 0,
    widthCells: rows[0]!.length,
    heightCells: rows.length,
    staticTerrain,
    playerSpawns: [],
    startingPlacements: [],
    resourcePlacements: [],
  });
  for (const [symbol, covered] of solids) {
    const x = Math.min(...covered.map((entry) => entry.x));
    const y = Math.min(...covered.map((entry) => entry.y));
    expect(
      grid.addFootprint(ids[symbol] ?? symbol.charCodeAt(0), {
        anchorCell: cell(x, y),
        width: Math.max(...covered.map((entry) => entry.x)) - x + 1,
        height: Math.max(...covered.map((entry) => entry.y)) - y + 1,
        blocksMovement: true,
        blocksBuilding: true,
      }),
    ).toEqual({ ok: true });
  }
  return grid;
}

function found(result: BreachPathResult): Extract<BreachPathResult, { status: "found" }> {
  expect(result.status).toBe("found");
  if (result.status !== "found") throw new Error("expected a route");
  return result;
}

function assertRoute(grid: SpatialGrid, result: BreachPathResult): void {
  const route = found(result);
  const blockers = new Set<number>();
  let first: number | null = null;
  route.pathCells.forEach((entry, index) => {
    expect(grid.isCellInBounds(entry) && grid.isStaticWalkable(entry)).toBe(true);
    if (index > 0) {
      const previous = route.pathCells[index - 1]!;
      expect(Math.abs(entry.x - previous.x) + Math.abs(entry.y - previous.y)).toBe(1);
    }
    const occupant = grid.occupantAt(entry);
    if (occupant !== null && grid.footprintOf(occupant)?.blocksMovement) {
      blockers.add(occupant);
      first ??= occupant;
    }
  });
  expect(route.pathLength).toBe(route.pathCells.length - 1);
  expect(route.breachCount).toBe(blockers.size);
  expect(route.firstBlockerEntityId).toBe(first);
}

/** Independent oracle: hypothetically remove a subset, then plain FIFO BFS. */
function subsetOracle(
  grid: SpatialGrid,
  start: CellCoord,
  goals: readonly CellCoord[],
  allowedIds: readonly number[],
): { breachCount: number; pathLength: number } | null {
  if (!grid.isCellInBounds(start) || !grid.isWalkable(start)) return null;
  const goalIds = new Set(
    goals.filter((entry) => grid.isWalkable(entry)).map((entry) => grid.cellId(entry)),
  );
  let best: { breachCount: number; pathLength: number } | null = null;
  for (let mask = 0; mask < 2 ** allowedIds.length; mask += 1) {
    const removed = new Set(allowedIds.filter((_, bit) => (mask & (1 << bit)) !== 0));
    const queue = [{ entry: start, distance: 0 }];
    const visited = new Set([grid.cellId(start)]);
    for (let index = 0; index < queue.length; index += 1) {
      const { entry, distance } = queue[index]!;
      if (goalIds.has(grid.cellId(entry))) {
        if (
          best === null ||
          removed.size < best.breachCount ||
          (removed.size === best.breachCount && distance < best.pathLength)
        ) {
          best = { breachCount: removed.size, pathLength: distance };
        }
        break;
      }
      for (const next of [
        cell(entry.x, entry.y - 1),
        cell(entry.x - 1, entry.y),
        cell(entry.x, entry.y + 1),
        cell(entry.x + 1, entry.y),
      ]) {
        if (!grid.isStaticWalkable(next)) continue;
        const occupant = grid.occupantAt(next);
        if (
          occupant !== null &&
          grid.footprintOf(occupant)?.blocksMovement &&
          !removed.has(occupant)
        )
          continue;
        const id = grid.cellId(next);
        if (visited.has(id)) continue;
        visited.add(id);
        queue.push({ entry: next, distance: distance + 1 });
      }
    }
  }
  return best;
}

describe("pure deterministic breach planner", () => {
  it("matches subset/BFS on 256 multi-cell, four-blocker and hostility queries", () => {
    const ids = [4000000000, 2, 900, 32];
    const starts = cell(0, 1);
    for (let terrainMask = 0; terrainMask < 8; terrainMask += 1) {
      const rows = [
        ["A", "A", ".", "."],
        [".", ".", "B", "."],
        ["C", "C", "B", "."],
        [".", ".", "D", "D"],
      ];
      [cell(2, 0), cell(1, 1), cell(0, 3)].forEach((entry, bit) => {
        if ((terrainMask & (1 << bit)) !== 0) rows[entry.y]![entry.x] = "#";
      });
      const grid = map(
        rows.map((row) => row.join("")),
        { A: ids[0]!, B: ids[1]!, C: ids[2]!, D: ids[3]! },
      );
      for (let allowedMask = 0; allowedMask < 16; allowedMask += 1) {
        const allowedIds = ids.filter((_, bit) => (allowedMask & (1 << bit)) !== 0);
        for (const goals of [[cell(3, 1)], [cell(3, 1), cell(1, 3), cell(3, 1), cell(-1, 0)]]) {
          const expected = subsetOracle(grid, starts, goals, allowedIds);
          const result = findBreachPath(grid, starts, goals, (id) => allowedIds.includes(id));
          if (expected === null) expect(result).toEqual({ status: "no_route" });
          else {
            expect(found(result)).toMatchObject(expected);
            assertRoute(grid, result);
            expect(goals).toContainEqual(found(result).pathCells.at(-1));
          }
          expect(
            findBreachPath(grid, starts, [...goals].reverse(), (id) => allowedIds.includes(id)),
          ).toEqual(result);
        }
      }
    }
  });

  it("does not prune a shorter superset label in favor of a longer subset prefix", () => {
    // At (1,0), {} arrives in 5 edges but {A} arrives in 3. The suffix must
    // breach A again, so both final counts are 1 and only {A} gives length 9.
    const grid = map(["......", ".A###A", "..###.", "..####"]);
    const start = cell(1, 3);
    const goals = [cell(5, 2)];
    const result = found(findBreachPath(grid, start, goals, allow));
    expect(result).toMatchObject({ breachCount: 1, pathLength: 9, firstBlockerEntityId: 65 });
    expect(result.pathCells).toContainEqual(cell(1, 1));
    expect(result).toMatchObject(subsetOracle(grid, start, goals, [65])!);
    assertRoute(grid, result);
  });

  it("handles shorter subset prefixes, dominated detours and stale replaced labels", () => {
    const grid = map(["...B..C.", "..A..#C.", ".....#C.", "...D.#C."]);
    const start = cell(0, 1);
    const goals = [cell(7, 2)];
    const ids = [65, 66, 67, 68];
    const expected = subsetOracle(grid, start, goals, ids)!;
    const result = found(findBreachPath(grid, start, goals, allow));
    expect(result).toMatchObject(expected);
    expect(result.firstBlockerEntityId).toBe(67);
    assertRoute(grid, result);
    expect(findBreachPath(grid, start, goals, allow)).toEqual(result);
  });

  it.each([31, 32, 33, 63, 64, 65, 96])("has no representation limit at %i blockers", (count) => {
    const grid = map([".".repeat(count * 2 + 1)]);
    const ids = Array.from({ length: count }, (_, index) => 4000000000 - index * 997);
    ids.forEach((id, index) => {
      expect(
        grid.addFootprint(id, {
          anchorCell: cell(index * 2 + 1, 0),
          width: 1,
          height: 1,
          blocksMovement: true,
          blocksBuilding: true,
        }),
      ).toEqual({ ok: true });
    });
    const start = cell(0, 0);
    const goals = [cell(count * 2, 0)];
    const result = found(findBreachPath(grid, start, goals, allow));
    expect(result).toMatchObject({
      breachCount: count,
      pathLength: count * 2,
      firstBlockerEntityId: ids[0],
    });
    assertRoute(grid, result);
    expect(findBreachPath(grid, start, goals, allow)).toEqual(result);
    expect(findBreachPath(grid, start, goals, (id) => id !== ids.at(-1))).toEqual({
      status: "no_route",
    });
  });

  it("matches an independent subset-removal/BFS oracle on 256 small map queries", () => {
    // Enumerate which entities are hypothetically removed, then ordinary BFS.
    // This oracle has no A* heuristic or per-cell breached-set search state.
    const start = cell(0, 1);
    const terrainCandidates = [cell(0, 0), cell(2, 0), cell(1, 1), cell(0, 2), cell(2, 2)];
    for (let terrainMask = 0; terrainMask < 32; terrainMask += 1) {
      const rows = [
        [".", "A", "."],
        [".", ".", "."],
        [".", "B", "."],
      ];
      terrainCandidates.forEach((entry, bit) => {
        if ((terrainMask & (1 << bit)) !== 0) rows[entry.y]![entry.x] = "#";
      });
      const grid = map(
        rows.map((row) => row.join("")),
        { A: 1, B: 2 },
      );
      for (let allowedMask = 0; allowedMask < 4; allowedMask += 1) {
        for (const goals of [[cell(2, 1)], [cell(2, 0), cell(2, 2), cell(2, 1)]]) {
          let optimal: { breachCount: number; pathLength: number } | null = null;
          for (let removed = 0; removed < 4; removed += 1) {
            if ((removed & allowedMask) !== removed) continue;
            const validGoalIds = new Set(
              goals.filter((entry) => grid.isWalkable(entry)).map((entry) => grid.cellId(entry)),
            );
            const queue = [{ entry: start, distance: 0 }];
            const visited = new Set([grid.cellId(start)]);
            for (let index = 0; index < queue.length; index += 1) {
              const { entry, distance } = queue[index]!;
              if (validGoalIds.has(grid.cellId(entry))) {
                const breachCount = (removed & 1) + ((removed >> 1) & 1);
                if (
                  optimal === null ||
                  breachCount < optimal.breachCount ||
                  (breachCount === optimal.breachCount && distance < optimal.pathLength)
                ) {
                  optimal = { breachCount, pathLength: distance };
                }
                break;
              }
              for (const next of [
                cell(entry.x - 1, entry.y),
                cell(entry.x, entry.y - 1),
                cell(entry.x + 1, entry.y),
                cell(entry.x, entry.y + 1),
              ]) {
                if (!grid.isStaticWalkable(next)) continue;
                const occupant = grid.occupantAt(next);
                if (occupant !== null && (removed & (1 << (occupant - 1))) === 0) continue;
                const id = grid.cellId(next);
                if (visited.has(id)) continue;
                visited.add(id);
                queue.push({ entry: next, distance: distance + 1 });
              }
            }
          }
          const result = findBreachPath(
            grid,
            start,
            goals,
            (id) => (allowedMask & (1 << (id - 1))) !== 0,
          );
          if (optimal === null) {
            expect(result).toEqual({ status: "no_route" });
          } else {
            expect(found(result)).toMatchObject(optimal);
            assertRoute(grid, result);
          }
        }
      }
    }
  });

  it("prefers a longer normal route over any breach route", () => {
    const grid = map([".....", "..A..", "....."]);
    const result = found(findBreachPath(grid, cell(0, 1), [cell(4, 1)], allow));
    expect(result).toEqual({
      status: "found",
      pathCells: findPath(grid, cell(0, 1), [cell(4, 1)]),
      breachCount: 0,
      pathLength: 6,
      firstBlockerEntityId: null,
    });
    assertRoute(grid, result);
  });

  it("prefers one breach over two even on a much longer route", () => {
    const grid = map([
      ".....C.....",
      ".#########.",
      ".#########.",
      ".#########.",
      ".#########.",
      ".AB........",
    ]);
    const result = found(findBreachPath(grid, cell(0, 5), [cell(10, 5)], allow));
    expect(result.breachCount).toBe(1);
    expect(result.firstBlockerEntityId).toBe("C".charCodeAt(0));
    expect(result.pathLength).toBe(20);
    assertRoute(grid, result);
  });

  it("uses shortest length when breach counts are equal", () => {
    const grid = map(["..A..", "..#..", "..B.."]);
    const result = found(findBreachPath(grid, cell(0, 0), [cell(4, 0)], allow));
    expect(result.breachCount).toBe(1);
    expect(result.pathLength).toBe(4);
    expect(result.firstBlockerEntityId).toBe("A".charCodeAt(0));
    assertRoute(grid, result);
  });

  it("breaks equal alternative costs by row-major cellId", () => {
    const grid = map(["..A..", "..#..", "..B.."], { A: 20, B: 1 });
    const result = found(findBreachPath(grid, cell(1, 1), [cell(3, 1)], allow));
    expect(result.pathCells).toEqual([cell(1, 1), cell(1, 0), cell(2, 0), cell(3, 0), cell(3, 1)]);
    expect(result.firstBlockerEntityId).toBe(20);
    for (let repeat = 0; repeat < 10; repeat += 1) {
      expect(findBreachPath(grid, cell(1, 1), [cell(3, 1)], allow)).toEqual(result);
    }
  });

  it("counts a multi-cell footprint once", () => {
    const grid = map([".AAAA."]);
    const result = found(findBreachPath(grid, cell(0, 0), [cell(5, 0)], allow));
    expect(result.breachCount).toBe(1);
    expect(result.pathLength).toBe(5);
    assertRoute(grid, result);
  });

  it("keeps different breached sets at the same cell and charges reentry only once", () => {
    // A is one rectangle over static holes. Routes via A and B both reach (1,0)
    // with (1 breach, 3 edges); only {A} can cross (5,1) without another breach.
    // A cell-only/cell+count search retains {B} first and incorrectly returns 2.
    const grid = map(["......", "BA###A", "..###."], { A: 10, B: 2 });
    const result = found(findBreachPath(grid, cell(0, 2), [cell(5, 2)], allow));
    expect(result).toEqual({
      status: "found",
      pathCells: [
        cell(0, 2),
        cell(1, 2),
        cell(1, 1),
        cell(1, 0),
        cell(2, 0),
        cell(3, 0),
        cell(4, 0),
        cell(5, 0),
        cell(5, 1),
        cell(5, 2),
      ],
      breachCount: 1,
      pathLength: 9,
      firstBlockerEntityId: 10,
    });
    assertRoute(grid, result);
  });

  it("returns the first encountered blocker, independent of numeric ID order", () => {
    const grid = map([".AABB."], { A: 30, B: 2 });
    const result = found(findBreachPath(grid, cell(0, 0), [cell(5, 0)], allow));
    expect(result.breachCount).toBe(2);
    expect(result.firstBlockerEntityId).toBe(30);
    assertRoute(grid, result);
  });

  it("never crosses static terrain, even under an allowed footprint", () => {
    const grid = map([".A#A."]);
    const result = findBreachPath(grid, cell(0, 0), [cell(4, 0)], allow);
    expect(result).toEqual({ status: "no_route" });
    expect(findBreachPath(map([".#."]), cell(0, 0), [cell(2, 0)], allow)).toEqual(result);
  });

  it("rejects friendly/non-breachable solids and selects only allowed blockers", () => {
    const grid = map(["..F..", "..#..", "..H.."], { F: 1, H: 2 });
    const result = found(findBreachPath(grid, cell(1, 1), [cell(3, 1)], (id) => id === 2));
    expect(result.firstBlockerEntityId).toBe(2);
    expect(result.pathCells).not.toContainEqual(cell(2, 0));
    expect(findBreachPath(grid, cell(1, 1), [cell(3, 1)], () => false)).toEqual({
      status: "no_route",
    });
    assertRoute(grid, result);
  });

  it("does not count non-movement-blocking footprints or classify them", () => {
    const grid = map(["..."]);
    grid.addFootprint(1, {
      anchorCell: cell(1, 0),
      width: 1,
      height: 1,
      blocksMovement: false,
      blocksBuilding: true,
    });
    const classify = vi.fn(() => false);
    const result = found(findBreachPath(grid, cell(0, 0), [cell(2, 0)], classify));
    expect(result.breachCount).toBe(0);
    expect(result.firstBlockerEntityId).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });

  it("does not virtually cross an occupant without a movement-blocking footprint", () => {
    const grid = map([".A."]);
    const wrapped: BreachGrid = {
      widthCells: grid.widthCells,
      heightCells: grid.heightCells,
      isCellInBounds: (entry) => grid.isCellInBounds(entry),
      cellId: (entry) => grid.cellId(entry),
      isWalkable: (entry) => grid.isWalkable(entry),
      isStaticWalkable: (entry) => grid.isStaticWalkable(entry),
      occupantAt: (entry) => grid.occupantAt(entry),
      footprintOf: () => undefined,
    };
    expect(findBreachPath(wrapped, cell(0, 0), [cell(2, 0)], allow)).toEqual({
      status: "no_route",
    });
  });

  it("chooses optimal multiple goals independently of order and duplicates", () => {
    const grid = map([".....", "..A..", "....."]);
    const start = cell(1, 1);
    const goals = [cell(3, 1), cell(1, 0), cell(1, 2), cell(1, 0)];
    const result = found(findBreachPath(grid, start, goals, allow));
    expect(result.pathCells).toEqual([start, cell(1, 0)]);
    expect(findBreachPath(grid, start, [...goals].reverse(), allow)).toEqual(result);
    const alternative = found(findBreachPath(grid, start, [cell(3, 1), cell(0, 2)], allow));
    expect(alternative.pathCells.at(-1)).toEqual(cell(0, 2));
    expect(alternative.breachCount).toBe(0);
  });

  it("supports approach goals without admitting the occupied target", () => {
    const grid = map(["..A.O."]);
    const goals = approachGoalCells(grid, grid.footprintOf("O".charCodeAt(0))!);
    const result = found(findBreachPath(grid, cell(0, 0), goals, allow));
    expect(result.pathCells.at(-1)).toEqual(cell(3, 0));
    expect(result.firstBlockerEntityId).toBe("A".charCodeAt(0));
    expect(result.pathLength).toBe(3);
  });

  it("handles same start/goal, map edges, and filters invalid or blocked goals", () => {
    const grid = map([".A.", "..."]);
    const invalid = [cell(-1, 0), cell(3, 0), cell(0, 2), cell(0.5, 0), cell(NaN, 0), cell(1, 0)];
    expect(findBreachPath(grid, cell(0, 0), [], allow)).toEqual({ status: "no_route" });
    expect(findBreachPath(grid, cell(0, 0), invalid, allow)).toEqual({ status: "no_route" });
    expect(findBreachPath(grid, cell(0, 0), [...invalid, cell(0, 0)], allow)).toEqual({
      status: "found",
      pathCells: [cell(0, 0)],
      breachCount: 0,
      pathLength: 0,
      firstBlockerEntityId: null,
    });
    const result = found(findBreachPath(grid, cell(0, 1), [...invalid, cell(2, 1)], allow));
    expect(result.pathCells).toEqual([cell(0, 1), cell(1, 1), cell(2, 1)]);
    for (const start of [...invalid, cell(0, -1)]) {
      expect(findBreachPath(grid, start, [cell(2, 1)], allow)).toEqual({ status: "no_route" });
    }
    expect(findBreachPath(map([".#."]), cell(0, 0), [cell(1, 0)], allow)).toEqual({
      status: "no_route",
    });
  });

  it("leaves occupancy, footprints, walkability, revision and input goals unchanged", () => {
    const grid = map([".AA.B."]);
    const snapshot = () => ({
      revision: grid.topologyRevision,
      cells: Array.from({ length: 6 }, (_, x) => ({
        occupant: grid.occupantAt(cell(x, 0)),
        walkable: grid.isWalkable(cell(x, 0)),
      })),
      footprints: [grid.footprintOf(65), grid.footprintOf(66)],
    });
    const before = structuredClone(snapshot());
    const start = Object.freeze(cell(0, 0));
    const goals = Object.freeze([Object.freeze(cell(5, 0))]);
    const classify = vi.fn(allow);
    const result = findBreachPath(grid, start, goals, classify);
    expect(findBreachPath(grid, start, goals, allow)).toEqual(result);
    expect(snapshot()).toEqual(before);
    expect(goals).toEqual([cell(5, 0)]);
    expect(classify.mock.calls.map(([id]) => id).sort((a, b) => a - b)).toEqual([65, 66]);
    expect(findPath(grid, start, goals)).toBeNull();
    assertRoute(grid, result);
  });
});
