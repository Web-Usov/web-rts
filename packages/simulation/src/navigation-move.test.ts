import { FOUNDATION_MAP, type MapDefinition } from "@web-rts/game-data";
import { describe, expect, it } from "vitest";
import { commandPathCost, scheduleCommands } from "./command-scheduler.js";
import type { QueuedCommand } from "./commands.js";
import { readComponentCache } from "./navigation-components.js";
import { planMove, planMoveToTarget, segmentIsTraversable } from "./navigation.js";
import { advanceToward } from "./systems/movement.js";
import { createMatchRuntime } from "./match-runtime.js";
import { readWorldEntities } from "./snapshot.js";
import { type SpatialFootprint } from "./spatial-grid.js";
import type { EntityId } from "./types.js";
import { createWorld, type World } from "./world.js";

function testMap(
  width: number,
  height: number,
  staticTerrain: MapDefinition["staticTerrain"] = [],
): MapDefinition {
  return {
    id: "nav-move",
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

function unitAt(world: World, x: number, y: number, playerId = 0): EntityId {
  const entityId = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
  world.positions.set(entityId, { x, y });
  world.owners.set(entityId, { ownerPlayerId: playerId });
  world.controllers.set(entityId, { controllerPlayerId: playerId });
  return entityId;
}

function move(
  entityIds: number[],
  target: { x: number; y: number },
  commandId = "move",
): QueuedCommand {
  return {
    actor: { playerId: 0 },
    command: { type: "MOVE", commandId, entityIds, target },
  };
}

function rejectionReasons(world: World): string[] {
  return world
    .drainEvents()
    .flatMap((event) => (event.type === "COMMAND_REJECTED" ? [event.reason] : []));
}

describe("MOVE navigation", () => {
  it("moves to the nearest reachable point for solid and static blocked targets", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 5) });
    const unit = unitAt(world, 0.5, 0.5);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    expect(world.placeSolidFootprint(blocker, solid(3, 1))).toEqual({ ok: true });
    world.drainEvents();

    world.enqueueCommand(move([unit], { x: 3.2, y: 1.4 }, "solid"));
    world.step();

    expect(rejectionReasons(world)).toEqual([]);
    expect(world.readNavigation(unit)?.destinationX).toBeCloseTo(2.9999, 12);
    expect(world.readNavigation(unit)?.destinationY).toBe(1.4);
    world.stepN(30);
    expect(world.positions.get(unit)!.x).toBeCloseTo(2.9999, 12);
    expect(world.positions.get(unit)!.y).toBe(1.4);
    expect(world.movements.has(unit)).toBe(false);

    const terrain = createWorld({
      seed: 1,
      map: testMap(4, 4, [{ x: 2, y: 2, width: 1, height: 1, walkable: false, buildable: false }]),
    });
    const terrainUnit = unitAt(terrain, 0.5, 0.5);
    terrain.drainEvents();
    terrain.enqueueCommand(move([terrainUnit], { x: 2.1, y: 2.1 }, "terrain"));
    terrain.step();
    expect(rejectionReasons(terrain)).toEqual([]);
    const effective = terrain.readNavigation(terrainUnit)!;
    expect(effective.destinationX).toBeCloseTo(2.1, 12);
    expect(effective.destinationY).toBeCloseTo(1.9999, 12);
    terrain.stepN(30);
    expect(terrain.positions.get(terrainUnit)!.x).toBeCloseTo(effective.destinationX, 12);
    expect(terrain.positions.get(terrainUnit)!.y).toBeCloseTo(effective.destinationY, 12);
  });

  it("reserves and deterministically plans a blocked-target MOVE for 16 distinct units", () => {
    const run = () => {
      const world = createWorld({ seed: 1, map: testMap(12, 12) });
      const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      expect(world.placeSolidFootprint(blocker, solid(8, 5, 2, 2))).toEqual({ ok: true });
      const units = Array.from({ length: 16 }, (_, i) =>
        unitAt(world, 0.5 + (i % 4), 0.5 + Math.floor(i / 4)),
      );
      expect(new Set(units).size).toBe(16);
      const target = { x: 8.2, y: 5.4 };
      const group = move(units, target, "distinct-group");
      const later = move([units[0]!], { x: 1.5, y: 1.5 }, "later");
      const queues = new Map([[0, [group.command, later.command]]]);
      const selected = scheduleCommands(queues, undefined, 16, 16, commandPathCost);
      expect(selected.reservedCost).toBe(units.length);
      expect(selected.selected.map(({ command }) => command.commandId)).toEqual(["distinct-group"]);
      expect(queues.get(0)).toEqual([later.command]);
      world.drainEvents();
      for (const { playerId, command } of selected.selected)
        world.enqueueCommand({ actor: { playerId }, command });
      world.step();
      expect(rejectionReasons(world)).toEqual([]);
      const plans = units.map((entityId) => {
        const task = world.readNavigation(entityId)!;
        expect(task).toBeDefined();
        // Nearest world-space projection is the left side, not a cell center.
        expect(task.destinationX).toBeCloseTo(7.9999, 12);
        expect(task.destinationY).toBe(target.y);
        const destination = { x: task.destinationX, y: task.destinationY };
        expect(segmentIsTraversable(world.grid!, destination, destination)).toBe(true);
        return { entityId, task };
      });
      world.stepN(60);
      for (const { entityId, task } of plans) {
        expect(world.positions.get(entityId)).toEqual({
          x: task.destinationX,
          y: task.destinationY,
        });
        expect(world.movements.has(entityId)).toBe(false);
      }
      return { plans, entities: readWorldEntities(world) };
    };
    expect(run()).toEqual(run());
  });

  it("keeps a resolved blocked destination fixed through removal and an unsafe-segment replan", () => {
    const world = createWorld({ seed: 87, map: testMap(7, 5), defaultMoveSpeed: 1 });
    const unit = unitAt(world, 0.5, 0.5);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(3, 2));
    world.enqueueCommand(move([unit], { x: 3.2, y: 2.4 }));
    world.step();
    const resolved = world.readNavigation(unit)!;
    expect(resolved.destinationX).toBeCloseTo(2.9999, 12);
    expect(readComponentCache(world.grid!)).not.toBeNull();
    world.removeSolidFootprint(blocker);
    const newBlocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    expect(world.placeSolidFootprint(newBlocker, solid(1, 1))).toEqual({ ok: true });
    expect(readComponentCache(world.grid!)).toBeNull();
    world.step();
    const replanned = world.readNavigation(unit)!;
    expect(replanned.plannedRevision).toBe(world.topologyRevision);
    expect([replanned.destinationX, replanned.destinationY]).toEqual([
      resolved.destinationX,
      resolved.destinationY,
    ]);
    world.stepN(60);
    expect(world.positions.get(unit)).toEqual({
      x: resolved.destinationX,
      y: resolved.destinationY,
    });
  });

  it("does not partially replace existing tasks when a warm-cache blocked group fails", () => {
    const world = createWorld({ seed: 87, map: testMap(7, 5), defaultMoveSpeed: 1 });
    const first = unitAt(world, 0.5, 0.5),
      second = unitAt(world, 6.5, 4.5);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(3, 2));
    world.enqueueCommand(move([first, second], { x: 3.5, y: 2.5 }));
    world.step();
    const before = [world.readNavigation(first), world.readNavigation(second)];
    // An invalid start exercises failure after the first unit has successfully planned.
    world.movements.remove(second);
    world.positions.set(second, { x: 3.5, y: 2.5 });
    world.drainEvents();
    world.enqueueCommand(move([first, second], { x: 3.2, y: 2.4 }, "rejected-warm-group"));
    world.step();
    expect(rejectionReasons(world)).toEqual(["no_path"]);
    expect([world.readNavigation(first), world.readNavigation(second)]).toEqual(before);
  });

  it("chooses the nearest reachable side, skipping closer disconnected cells", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 3) });
    const unit = unitAt(world, 0.5, 1.5);
    for (let y = 0; y < 3; y += 1) {
      const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      world.placeSolidFootprint(wall, solid(2, y));
    }
    const requested = { x: 2.9, y: 1.5 };
    const first = planMoveToTarget(world.grid!, world.positions.get(unit)!, requested)!;
    expect(first.destinationX).toBeCloseTo(1.9999, 12);
    expect(first.destinationY).toBe(1.5);
    expect(planMoveToTarget(world.grid!, world.positions.get(unit)!, requested)).toEqual(first);
    let previous = world.positions.get(unit)!;
    for (const waypoint of first.waypoints) {
      expect(segmentIsTraversable(world.grid!, previous, waypoint)).toBe(true);
      previous = waypoint;
    }
  });

  it("resolves blocked edge/corner endpoints without changing valid exact targets", () => {
    const world = createWorld({ seed: 1, map: testMap(4, 4) });
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(2, 2));
    const start = { x: 0.5, y: 0.5 };
    const edge = planMoveToTarget(world.grid!, start, { x: 2, y: 2 })!;
    expect(segmentIsTraversable(world.grid!, edge.waypoints.at(-1)!, edge.waypoints.at(-1)!)).toBe(
      true,
    );
    const valid = { x: 1.2, y: 1.3 };
    expect(planMoveToTarget(world.grid!, start, valid)?.waypoints.at(-1)).toEqual(valid);
    expect(planMoveToTarget(world.grid!, start, { x: 4, y: 2 })).toBeNull();
    expect(planMoveToTarget(world.grid!, { x: 2.5, y: 2.5 }, { x: 2.5, y: 2.5 })).toBeNull();
  });

  it("breaks equal-distance ties by cellId and resolves each unit's reachable component", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 3), defaultMoveSpeed: 50 });
    const left = unitAt(world, 0.5, 1.5);
    const right = unitAt(world, 4.5, 1.5);
    for (let y = 0; y < 3; y += 1) {
      const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      world.placeSolidFootprint(blocker, solid(2, y));
    }
    world.drainEvents();
    world.enqueueCommand(move([left, right], { x: 2.5, y: 1.5 }));
    world.step();
    expect(rejectionReasons(world)).toEqual([]);
    expect(world.positions.get(left)!.x).toBeCloseTo(1.9999, 12);
    expect(world.positions.get(right)!.x).toBeCloseTo(3.0001, 12);

    const tie = createWorld({ seed: 1, map: testMap(3, 3) });
    const blocker = tie.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    tie.placeSolidFootprint(blocker, solid(1, 1));
    const route = planMoveToTarget(tie.grid!, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 })!;
    expect(route.destinationX).toBe(1.5);
    expect(route.destinationY).toBeCloseTo(0.9999, 12);
  });

  it("checks authorization after bounds and before resolving blocked targets", () => {
    const world = createWorld({ seed: 1, map: testMap(4, 4) });
    const own = unitAt(world, 0.5, 0.5);
    const foreign = unitAt(world, 0.5, 0.5, 1);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(2, 2));
    world.drainEvents();

    world.enqueueCommand(move([], { x: 2.5, y: 2.5 }, "empty"));
    world.enqueueCommand(move([foreign], { x: 20, y: 0 }, "oob"));
    world.enqueueCommand(move([foreign], { x: 2.5, y: 2.5 }, "blocked-foreign"));
    world.enqueueCommand(move([own], { x: 1.5, y: 0.5 }, "ok"));
    world.step();

    expect(rejectionReasons(world)).toEqual(["empty_entity_ids", "out_of_bounds", "not_your_unit"]);
    expect(world.movements.has(own)).toBe(true);
    expect(world.movements.has(foreign)).toBe(false);
  });

  it("rejects an unreachable direct target with no_path and keeps the group atomic", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 3) });
    const reachable = unitAt(world, 0.5, 1.5);
    const trapped = unitAt(world, 4.2, 1.5);
    for (let y = 0; y < 3; y += 1) {
      const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      world.placeSolidFootprint(wall, solid(2, y));
    }
    world.drainEvents();

    world.enqueueCommand(move([reachable, trapped], { x: 0.8, y: 1.2 }, "group"));
    world.step();

    expect(rejectionReasons(world)).toEqual(["no_path"]);
    expect(world.positions.get(reachable)).toEqual({ x: 0.5, y: 1.5 });
    expect(world.positions.get(trapped)).toEqual({ x: 4.2, y: 1.5 });
    expect(world.movements.has(reachable)).toBe(false);
    expect(world.readNavigation(reachable)).toBeUndefined();
    expect(world.readNavigation(trapped)).toBeUndefined();
  });

  it("reaches the exact world destination using a single smoothed segment", () => {
    const world = createWorld({
      seed: 1,
      map: testMap(6, 1),
      defaultMoveSpeed: 15,
    });
    const unit = unitAt(world, 0.5, 0.5);
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 3.2, y: 0.5 }));
    world.step();

    expect(world.positions.get(unit)!.x).toBeCloseTo(2, 12);
    expect(world.positions.get(unit)!.y).toBe(0.5);
    expect(world.readNavigation(unit)?.waypoints.map((point) => point.x)).toEqual([3.2]);

    world.stepN(4);
    expect(world.positions.get(unit)).toEqual({ x: 3.2, y: 0.5 });
    expect(world.movements.has(unit)).toBe(false);
    expect(world.readNavigation(unit)).toBeUndefined();
  });

  it("moves straight to a target inside the current cell", () => {
    const world = createWorld({ seed: 1, map: testMap(3, 3), defaultMoveSpeed: 5 });
    const unit = unitAt(world, 0.2, 0.2);
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 0.8, y: 0.4 }));
    world.step();

    const distance = Math.hypot(0.6, 0.2);
    const ratio = 0.5 / distance;
    const position = world.positions.get(unit)!;
    expect(position.x).toBeCloseTo(0.2 + 0.6 * ratio, 8);
    expect(position.y).toBeCloseTo(0.2 + 0.2 * ratio, 8);
    expect(world.readNavigation(unit)?.pathCells).toEqual([{ x: 0, y: 0 }]);

    world.stepN(3);
    expect(world.positions.get(unit)).toEqual({ x: 0.8, y: 0.4 });
  });

  it("routes around a solid footprint and still stops on the exact destination", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 3), defaultMoveSpeed: 5 });
    const unit = unitAt(world, 0.5, 1.5);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(2, 1));
    const other = unitAt(world, 1.5, 1.5);
    world.drainEvents();

    world.enqueueCommand(move([unit], { x: 4.25, y: 1.4 }));
    world.step();
    const withUnit = world.readNavigation(unit)?.pathCells;
    const clear = createWorld({ seed: 1, map: testMap(5, 3) });
    const solo = unitAt(clear, 0.5, 1.5);
    const soloBlocker = clear.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    clear.placeSolidFootprint(soloBlocker, solid(2, 1));
    clear.enqueueCommand(move([solo], { x: 4.25, y: 1.4 }));
    clear.step();
    expect(withUnit).toEqual(clear.readNavigation(solo)?.pathCells);
    expect(withUnit).not.toContainEqual({ x: 2, y: 1 });

    const seen = new Set<string>();
    for (let tick = 0; tick < 30; tick += 1) {
      const position = world.positions.get(unit)!;
      const cell = world.grid!.worldToCell(position);
      seen.add(`${cell.x},${cell.y}`);
      if (!world.movements.has(unit)) {
        break;
      }
      world.step();
    }

    expect(world.positions.get(unit)).toEqual({ x: 4.25, y: 1.4 });
    expect(seen.has("2,1")).toBe(false);
    expect(world.positions.get(other)).toEqual({ x: 1.5, y: 1.5 });
  });

  it("keeps the existing path when an unrelated topology change does not block it", () => {
    const world = createWorld({ seed: 1, map: testMap(6, 3), defaultMoveSpeed: 1 });
    const unit = unitAt(world, 1.5, 1.5);
    const center = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(center, solid(2, 1));
    const south: EntityId[] = [];
    for (const x of [1, 2, 3]) {
      const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      south.push(wall);
      world.placeSolidFootprint(wall, solid(x, 0));
    }
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 3.5, y: 1.5 }));
    world.step();

    const before = world.readNavigation(unit);
    expect(before?.pathCells).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
    ]);
    const yAfterFirst = world.positions.get(unit)!.y;
    expect(yAfterFirst).toBeGreaterThan(1.5);

    for (const wall of south) {
      expect(world.removeSolidFootprint(wall)).toBe(true);
    }
    expect(world.topologyRevision).toBeGreaterThan(before!.plannedRevision);
    world.step();

    const after = world.readNavigation(unit);
    expect(after?.pathCells).toEqual(before?.pathCells);
    expect(after?.plannedRevision).toBe(before?.plannedRevision);
    expect(world.positions.get(unit)!.y).toBeGreaterThan(yAfterFirst);
  });

  it("replans before entering a newly blocked cell and reaches the destination", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 3), defaultMoveSpeed: 5 });
    const unit = unitAt(world, 0.5, 1.5);
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 4.5, y: 1.5 }));
    world.stepN(2);
    expect(world.positions.get(unit)).toEqual({ x: 1.5, y: 1.5 });

    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(2, 1));
    world.step();
    expect(world.readNavigation(unit)?.pathCells).not.toContainEqual({ x: 2, y: 1 });
    expect(world.readNavigation(unit)?.plannedRevision).toBe(world.topologyRevision);

    const seen = new Set<string>();
    for (let tick = 0; tick < 40; tick += 1) {
      const position = world.positions.get(unit)!;
      const cell = world.grid!.worldToCell(position);
      seen.add(`${cell.x},${cell.y}`);
      if (!world.movements.has(unit)) {
        break;
      }
      world.step();
    }

    expect(seen.has("2,1")).toBe(false);
    expect(world.positions.get(unit)).toEqual({ x: 4.5, y: 1.5 });
  });

  it("stops before a blocked cell when the replan has no path", () => {
    const world = createWorld({ seed: 1, map: testMap(4, 1), defaultMoveSpeed: 5 });
    const unit = unitAt(world, 0.2, 0.5);
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 3.5, y: 0.5 }));
    world.step();
    const stoppedAt = world.positions.get(unit)!;
    expect(stoppedAt.x).toBeLessThan(1);

    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(1, 0));
    world.step();

    expect(world.positions.get(unit)).toEqual(stoppedAt);
    expect(world.grid!.worldToCell(world.positions.get(unit)!)).toEqual({ x: 0, y: 0 });
    expect(world.movements.has(unit)).toBe(false);
    expect(world.readNavigation(unit)).toBeUndefined();
    expect(world.drainEvents().some((event) => event.type === "COMMAND_REJECTED")).toBe(false);
  });

  it("does not publish navigation state on the match snapshot", () => {
    const world = createWorld({ seed: 1, map: testMap(4, 4) });
    const unit = unitAt(world, 0.5, 0.5);
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 3.25, y: 0.5 }));
    world.step();
    expect(world.readNavigation(unit)?.pathCells.length).toBeGreaterThan(1);

    const entity = readWorldEntities(world)[0]!;
    expect(Object.keys(entity).sort()).toEqual([
      "controllerPlayerId",
      "definitionId",
      "entityId",
      "kind",
      "objectiveState",
      "objectiveType",
      "ownerPlayerId",
      "x",
      "y",
    ]);
    expect(JSON.stringify(readWorldEntities(world))).not.toMatch(
      /pathCells|waypoint|plannedRevision/,
    );

    const runtime = createMatchRuntime({
      seed: 1,
      mapId: FOUNDATION_MAP.id,
      participants: [{ playerId: 0 }],
    });
    const snapshotUnit = runtime.readSnapshot().entities.find((entry) => entry.kind === "UNIT")!;
    runtime.submitCommand(
      { playerId: 0 },
      {
        type: "MOVE",
        commandId: "snap",
        entityIds: [snapshotUnit.entityId],
        target: { x: 4, y: -3 },
      },
    );
    runtime.step();
    const snapshot = runtime.readSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual(["entities", "status", "tick"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/pathCells|waypoint|plannedRevision|navigation/);
  });

  it("repeats positions for the same setup, commands and ticks", () => {
    const sample = (): Array<[number, number]> => {
      const world = createWorld({ seed: 4, map: testMap(5, 3), defaultMoveSpeed: 5 });
      const unit = unitAt(world, 0.5, 1.5);
      const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      world.placeSolidFootprint(blocker, solid(2, 1));
      world.enqueueCommand(move([unit], { x: 4.25, y: 1.75 }));
      const positions: Array<[number, number]> = [];
      for (let tick = 0; tick < 16; tick += 1) {
        world.step();
        const position = world.positions.get(unit)!;
        positions.push([position.x, position.y]);
      }
      return positions;
    };

    expect(sample()).toEqual(sample());
  });
});

describe("smoothed movement regressions", () => {
  it("matches direct Movement displacement on an open diagonal", () => {
    const options = { seed: 1, defaultMoveSpeed: 5 };
    const direct = createWorld(options);
    const routed = createWorld({ ...options, map: testMap(8, 8) });
    const a = unitAt(direct, 0.2, 0.3);
    const b = unitAt(routed, 0.2, 0.3);
    const target = { x: 6.7, y: 5.8 };
    direct.enqueueCommand(move([a], target));
    routed.enqueueCommand(move([b], target));
    for (let tick = 0; tick < 20; tick += 1) {
      direct.step();
      routed.step();
      expect(routed.positions.get(b)).toEqual(direct.positions.get(a));
    }
    expect(routed.positions.get(b)).toEqual(target);
  });

  it("spends the full tick budget through multiple smoothed turns in Movement", () => {
    const world = createWorld({ seed: 1, map: testMap(7, 5), defaultMoveSpeed: 65 });
    const unit = unitAt(world, 0.5, 2.5);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(3, 1, 1, 2));
    const target = { x: 6.2, y: 2.3 };
    const route = planMove(world.grid!, world.positions.get(unit)!, target)!;
    expect(route.waypoints.length).toBeGreaterThan(1);
    let expected = world.positions.get(unit)!;
    let budget = 6.5;
    let arrived = 0;
    for (const point of route.waypoints) {
      const step = advanceToward(expected, point, budget);
      expected = step.position;
      budget = step.remaining;
      if (!step.arrived) break;
      arrived += 1;
    }
    expect(arrived).toBeGreaterThan(1);
    world.enqueueCommand(move([unit], target));
    world.step();
    expect(world.positions.get(unit)).toEqual(expected);
  });

  it("invalidates a blocker far inside the active segment and smooths the replan", () => {
    const world = createWorld({ seed: 1, map: testMap(9, 5), defaultMoveSpeed: 5 });
    const unit = unitAt(world, 0.5, 2.5);
    world.enqueueCommand(move([unit], { x: 8.2, y: 2.5 }));
    world.step();
    const before = world.readNavigation(unit)!;
    expect(before.waypoints).toHaveLength(1);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(5, 2));
    world.step();
    const after = world.readNavigation(unit)!;
    expect(after.plannedRevision).toBe(world.topologyRevision);
    expect(after.pathCells).not.toContainEqual({ x: 5, y: 2 });
    expect(after.waypoints.length).toBeLessThan(after.pathCells.length);
    let previous = world.positions.get(unit)!;
    while (world.movements.has(unit)) {
      world.step();
      const current = world.positions.get(unit)!;
      expect(segmentIsTraversable(world.grid!, previous, current)).toBe(true);
      previous = current;
    }
    expect(previous).toEqual({ x: 8.2, y: 2.5 });
  });
});

describe("future segment topology validation", () => {
  it("keeps a safe active segment but replans before an unsafe later segment", () => {
    const world = createWorld({ seed: 1, map: testMap(7, 6), defaultMoveSpeed: 5 });
    const unit = unitAt(world, 0.5, 0.5);
    const original = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(original, solid(1, 0, 1, 3));
    world.enqueueCommand(move([unit], { x: 6.5, y: 3.5 }));
    world.step();
    const before = world.readNavigation(unit)!;
    expect(before.waypoints.length).toBeGreaterThan(1);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(blocker, solid(4, 3));
    world.step();
    expect(world.readNavigation(unit)!.plannedRevision).toBe(before.plannedRevision);
    let replanned = false;
    let previous = world.positions.get(unit)!;
    for (let tick = 0; tick < 50; tick += 1) {
      world.step();
      const current = world.positions.get(unit)!;
      expect(segmentIsTraversable(world.grid!, previous, current)).toBe(true);
      previous = current;
      const task = world.readNavigation(unit);
      if (task && task.plannedRevision > before.plannedRevision) replanned = true;
      if (!world.movements.has(unit)) break;
    }
    expect(replanned).toBe(true);
    expect(previous).toEqual({ x: 6.5, y: 3.5 });
  });
});

describe("bounded active-task replans", () => {
  it("serves ascending entity ids even after movement insertion is reversed, safely defers the peer", () => {
    const world = createWorld({
      seed: 1,
      map: testMap(7, 5),
      defaultMoveSpeed: 1,
      pathQueriesPerTick: { activeTaskBudget: 1 },
    });
    const first = unitAt(world, 0.5, 1.5);
    const second = unitAt(world, 0.5, 3.5);
    world.enqueueCommand(move([second], { x: 6.5, y: 3.5 }, "second"));
    world.enqueueCommand(move([first], { x: 6.5, y: 1.5 }, "first"));
    world.step();
    for (const y of [1, 3]) {
      const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      expect(world.placeSolidFootprint(wall, solid(3, y))).toEqual({ ok: true });
    }
    const before = world.positions.get(second)!;
    const oldTask = world.readNavigation(second)!;
    world.step();
    expect(world.readPathQueryMetrics()).toEqual({ activeTaskQueries: 1, aiQueries: 0 });
    expect(world.readNavigation(first)!.plannedRevision).toBe(world.topologyRevision);
    expect(world.readNavigation(second)).toEqual(oldTask);
    expect(world.positions.get(second)).toEqual(before);
    expect(world.movements.has(second)).toBe(true);
    world.step();
    expect(world.readNavigation(second)!.plannedRevision).toBe(world.topologyRevision);
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    let previous = world.positions.get(second)!;
    for (let tick = 0; tick < 100; tick++) {
      world.step();
      const current = world.positions.get(second)!;
      expect(segmentIsTraversable(world.grid!, previous, current)).toBe(true);
      previous = current;
    }
    expect(previous).toEqual({ x: 6.5, y: 3.5 });
  });
  it("unrelated changes and safe multi-waypoint transitions do not spend query budget", () => {
    const world = createWorld({
      seed: 1,
      map: testMap(9, 5),
      defaultMoveSpeed: 30,
      pathQueriesPerTick: { activeTaskBudget: 1 },
    });
    const unit = unitAt(world, 0.5, 2.5);
    const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(wall, solid(4, 2));
    world.enqueueCommand(move([unit], { x: 8.5, y: 2.5 }));
    world.step();
    const distant = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(distant, solid(0, 4));
    world.step();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(0);
  });
  it("defers at a later unsafe segment after spending distance on the safe segment", () => {
    const world = createWorld({
      seed: 1,
      map: testMap(9, 7),
      defaultMoveSpeed: 1,
      pathQueriesPerTick: { activeTaskBudget: 1 },
    });
    const first = unitAt(world, 0.5, 5.5);
    const second = unitAt(world, 0.5, 0.5);
    const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(wall, solid(1, 0, 1, 3));
    world.enqueueCommand(move([first], { x: 8.5, y: 5.5 }, "first"));
    world.enqueueCommand(move([second], { x: 8.5, y: 3.5 }, "second"));
    world.step();
    for (const [x, y] of [
      [4, 5],
      [5, 3],
    ]) {
      const block = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
      world.placeSolidFootprint(block, solid(x!, y!));
    }
    // Complete the safe initial segment in this tick, then discover invalid later segment.
    world.movements.set(second, { ...world.movements.get(second)!, speed: 80 });
    const previous = world.positions.get(second)!;
    world.step();
    const deferred = world.readNavigation(second)!;
    expect(deferred.waypointIndex).toBeGreaterThan(0);
    expect(deferred.plannedRevision).toBeLessThan(world.topologyRevision);
    expect(segmentIsTraversable(world.grid!, previous, world.positions.get(second)!)).toBe(true);
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    world.step();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    expect(world.readNavigation(second)!.plannedRevision).toBe(world.topologyRevision);
    world.stepN(3);
    expect(world.positions.get(second)).toEqual({ x: 8.5, y: 3.5 });
  });
});
