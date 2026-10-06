import { FOUNDATION_MAP, type MapDefinition } from "@web-rts/game-data";
import { describe, expect, it } from "vitest";
import type { QueuedCommand } from "./commands.js";
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
  it("rejects a blocked direct target and does not search for a nearby cell", () => {
    const world = createWorld({ seed: 1, map: testMap(5, 5) });
    const unit = unitAt(world, 0.5, 0.5);
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    expect(world.placeSolidFootprint(blocker, solid(3, 1))).toEqual({ ok: true });
    world.drainEvents();

    world.enqueueCommand(move([unit], { x: 3.2, y: 1.4 }, "solid"));
    world.step();

    expect(rejectionReasons(world)).toEqual(["blocked_target"]);
    expect(world.positions.get(unit)).toEqual({ x: 0.5, y: 0.5 });
    expect(world.movements.has(unit)).toBe(false);
    expect(world.readNavigation(unit)).toBeUndefined();

    const terrain = createWorld({
      seed: 1,
      map: testMap(4, 4, [{ x: 2, y: 2, width: 1, height: 1, walkable: false, buildable: false }]),
    });
    const terrainUnit = unitAt(terrain, 0.5, 0.5);
    terrain.drainEvents();
    terrain.enqueueCommand(move([terrainUnit], { x: 2.1, y: 2.1 }, "terrain"));
    terrain.step();
    expect(rejectionReasons(terrain)).toEqual(["blocked_target"]);
    expect(terrain.positions.get(terrainUnit)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("checks blocked_target after bounds and before controller", () => {
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

    expect(rejectionReasons(world)).toEqual([
      "empty_entity_ids",
      "out_of_bounds",
      "blocked_target",
    ]);
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

  it("reaches the exact world destination and spends leftover budget past a waypoint", () => {
    const world = createWorld({
      seed: 1,
      map: testMap(6, 1),
      defaultMoveSpeed: 15,
    });
    const unit = unitAt(world, 0.5, 0.5);
    world.drainEvents();
    world.enqueueCommand(move([unit], { x: 3.2, y: 0.5 }));
    world.step();

    expect(world.positions.get(unit)).toEqual({ x: 2, y: 0.5 });
    expect(world.readNavigation(unit)?.waypoints.map((point) => point.x)).toEqual([1.5, 2.5, 3.2]);

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
