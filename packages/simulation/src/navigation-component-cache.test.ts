import type { MapDefinition } from "@web-rts/game-data";
import { describe, expect, it } from "vitest";
import { readComponentCache } from "./navigation-components.js";
import {
  MoveTargetResolution,
  NEIGHBOR_OFFSETS,
  planMove,
  planMoveToTarget,
  segmentIsTraversable,
  type NavigationWork,
} from "./navigation.js";
import { SpatialGrid, type SpatialFootprint } from "./spatial-grid.js";
import type { Vec2 } from "./types.js";

const map = (
  terrain: MapDefinition["staticTerrain"] = [],
  originX = 0,
  originY = 0,
): MapDefinition => ({
  id: "same-map-id",
  widthCells: 7,
  heightCells: 5,
  originX,
  originY,
  staticTerrain: terrain,
  playerSpawns: [],
  startingPlacements: [],
  resourcePlacements: [],
});
const solid = (x: number, y: number): SpatialFootprint => ({
  anchorCell: { x, y },
  width: 1,
  height: 1,
  blocksMovement: true,
  blocksBuilding: true,
});
const work = (): NavigationWork => ({
  astarExpandedCells: 0,
  blockedTargetVisitedCells: 0,
  componentLabelBuilds: 0,
  componentLabelRebuilds: 0,
  componentLabelVisitedCells: 0,
  componentCacheHits: 0,
  componentReuseHits: 0,
  componentCandidateEvaluations: 0,
});

/** Uncached G4a reference: full BFS + exact original projection + ordinary route/smoothing. */
function reference(grid: SpatialGrid, origin: Vec2, requested: Vec2) {
  if (!grid.containsWorldPoint(requested)) return null;
  if (segmentIsTraversable(grid, requested, requested)) return planMove(grid, origin, requested);
  const start = grid.worldToCell(origin);
  if (!grid.isCellInBounds(start) || !grid.isWalkable(start)) return null;
  const seen = new Set([grid.cellId(start)]);
  const queue = [start];
  let best: Vec2 | null = null,
    distance = Infinity,
    bestId = Infinity;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    const center = grid.cellToWorldCenter(cell);
    const point = {
      x: Math.max(center.x - 0.5 + 0.0001, Math.min(center.x + 0.5 - 0.0001, requested.x)),
      y: Math.max(center.y - 0.5 + 0.0001, Math.min(center.y + 0.5 - 0.0001, requested.y)),
    };
    const d = (point.x - requested.x) ** 2 + (point.y - requested.y) ** 2;
    const id = grid.cellId(cell);
    if (d < distance || (d === distance && id < bestId)) {
      best = point;
      distance = d;
      bestId = id;
    }
    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: cell.x + offset.x, y: cell.y + offset.y };
      if (!grid.isCellInBounds(next) || !grid.isWalkable(next)) continue;
      const nextId = grid.cellId(next);
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      queue.push(next);
    }
  }
  return best === null ? null : planMove(grid, origin, best);
}

describe("blocked MOVE component cache", () => {
  it("labels once, reuses a group projection, keeps separate deterministic routes", () => {
    const grid = new SpatialGrid(map());
    grid.addFootprint(1, solid(1, 1));
    const target = { x: 1.5, y: 1.5 },
      scope = new MoveTargetResolution(grid, target),
      w = work();
    const origins = [
      { x: 0.5, y: 0.5 },
      { x: 6.5, y: 4.5 },
    ];
    const tasks = origins.map((origin) => planMoveToTarget(grid, origin, target, w, scope));
    expect(tasks).toEqual(origins.map((origin) => reference(grid, origin, target)));
    expect(tasks[0]!.pathCells).not.toEqual(tasks[1]!.pathCells);
    expect(tasks[0]!.destinationY).toBe(0.9999); // equal-distance tie: lowest cellId
    expect(tasks[0]!.destinationX).toBe(1.5); // world projection, not center
    expect(w).toMatchObject({
      componentLabelBuilds: 1,
      componentLabelVisitedCells: 34,
      blockedTargetVisitedCells: 0,
      componentCandidateEvaluations: 34,
      componentCacheHits: 1,
      componentReuseHits: 1,
    });
    expect(readComponentCache(grid)).toEqual({
      revision: 1,
      labelledComponents: 1,
      labelledCells: 34,
      retainedArrayBytes: 35 * 8,
    });
    const repeat = work();
    expect(planMoveToTarget(grid, origins[0]!, target, repeat)).toEqual(tasks[0]);
    expect(repeat).toMatchObject({
      componentLabelBuilds: 0,
      componentLabelVisitedCells: 0,
      componentCacheHits: 1,
      componentCandidateEvaluations: 34,
    });
  });

  it("resolves different components separately and evaluates each only once per group", () => {
    const grid = new SpatialGrid(
      map([{ x: 3, y: 0, width: 1, height: 5, walkable: false, buildable: false }]),
    );
    const target = { x: 3.5, y: 2.5 },
      scope = new MoveTargetResolution(grid, target),
      w = work();
    const origins = [
      { x: 0.5, y: 0.5 },
      { x: 6.5, y: 4.5 },
      { x: 1.5, y: 3.5 },
      { x: 5.5, y: 1.5 },
    ];
    const tasks = origins.map((origin) => planMoveToTarget(grid, origin, target, w, scope));
    expect(tasks).toEqual(origins.map((origin) => reference(grid, origin, target)));
    expect(tasks.map((t) => t!.destinationX)).toEqual([2.9999, 4.0001, 2.9999, 4.0001]);
    expect(w).toMatchObject({
      componentLabelBuilds: 2,
      componentLabelVisitedCells: 30,
      componentCandidateEvaluations: 30,
      componentReuseHits: 2,
    });
    expect(planMoveToTarget(grid, origins[0]!, { x: 5.5, y: 2.5 })).toBeNull(); // valid unreachable target
  });

  it("invalidates both labels and a reused scope after add/remove, but keeps no-op state", () => {
    const grid = new SpatialGrid(map());
    grid.addFootprint(1, solid(3, 2));
    const origin = { x: 0.5, y: 0.5 },
      target = { x: 3.2, y: 2.4 },
      scope = new MoveTargetResolution(grid, target);
    const initial = planMoveToTarget(grid, origin, target, undefined, scope);
    const cache = readComponentCache(grid);
    expect(grid.addFootprint(2, solid(3, 2))).toEqual({ ok: false, reason: "occupied" });
    expect(grid.addFootprint(1, solid(4, 4))).toEqual({ ok: false, reason: "occupied" });
    expect(grid.removeFootprint(999)).toBe(false);
    expect(readComponentCache(grid)).toEqual(cache);
    const noOp = work();
    expect(planMoveToTarget(grid, origin, target, noOp, scope)).toEqual(initial);
    expect(noOp.componentReuseHits).toBe(1);
    expect(noOp.componentLabelBuilds).toBe(0);
    grid.addFootprint(2, solid(2, 2));
    expect(readComponentCache(grid)).toBeNull();
    const rebuild = work();
    expect(planMoveToTarget(grid, origin, target, rebuild, scope)).toEqual(
      reference(grid, origin, target),
    );
    expect(rebuild).toMatchObject({
      componentLabelRebuilds: 1,
      componentLabelBuilds: 1,
      componentLabelVisitedCells: 33,
      componentReuseHits: 0,
    });
    grid.removeFootprint(2);
    expect(readComponentCache(grid)).toBeNull();
    const removed = work();
    expect(planMoveToTarget(grid, origin, target, removed, scope)).toEqual(
      reference(grid, origin, target),
    );
    expect(removed.componentLabelRebuilds).toBe(1);
    grid.removeFootprint(1);
    const exact = work();
    const task = planMoveToTarget(grid, origin, target, exact, scope)!;
    expect([task.destinationX, task.destinationY]).toEqual([target.x, target.y]);
    expect(exact.componentLabelBuilds).toBe(0); // exact reachable MOVE never builds labels
  });

  it("never shares labels/destinations between grid identities or requested coordinates", () => {
    const a = new SpatialGrid(map()),
      b = new SpatialGrid(
        map([{ x: 3, y: 0, width: 1, height: 5, walkable: false, buildable: true }]),
      );
    a.addFootprint(1, solid(3, 2));
    b.addFootprint(1, solid(1, 1));
    expect(a.topologyRevision).toBe(b.topologyRevision);
    const target = { x: 3.5, y: 2.5 },
      origin = { x: 0.5, y: 0.5 },
      scope = new MoveTargetResolution(a, target);
    planMoveToTarget(a, origin, target, undefined, scope);
    expect(readComponentCache(b)).toBeNull();
    const w = work();
    expect(planMoveToTarget(b, origin, target, w, scope)).toEqual(reference(b, origin, target));
    expect(w.componentLabelBuilds).toBe(1);
    const changed = { x: 3.9, y: 2.9 };
    expect(planMoveToTarget(a, origin, changed, undefined, scope)).toEqual(
      reference(a, origin, changed),
    );
  });

  it("matches uncached outputs for translated grids, static/dynamic blockers and edge/corner targets", () => {
    for (const [ox, oy] of [
      [0, 0],
      [0.125, -13.75],
    ]) {
      const grid = new SpatialGrid(
        map(
          [
            { x: 3, y: 0, width: 1, height: 5, walkable: false, buildable: false },
            { x: 1, y: 3, width: 1, height: 1, walkable: false, buildable: false },
          ],
          ox,
          oy,
        ),
      );
      grid.addFootprint(1, solid(5, 2));
      const targets = [
        { x: 3.2, y: 2.4 },
        { x: 3, y: 2 },
        { x: 5.9, y: 2.9 },
        { x: 5, y: 2 },
        { x: 6.5, y: 4.5 },
        { x: -0.1, y: 0.5 },
      ].map((p) => ({ x: p.x + ox!, y: p.y + oy! }));
      for (const target of targets) {
        const scope = new MoveTargetResolution(grid, target);
        for (let y = 0; y < 5; y++)
          for (let x = 0; x < 7; x++) {
            if (!grid.isWalkable({ x, y })) continue;
            const origin = { x: ox! + x + 0.37, y: oy! + y + 0.61 };
            const expected = reference(grid, origin, target);
            expect(planMoveToTarget(grid, origin, target, undefined, scope)).toEqual(expected);
            expect(planMoveToTarget(grid, origin, target)).toEqual(expected);
          }
      }
    }
  });
});
