import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP } from "@web-rts/game-data";
import type { SpatialFootprint } from "./spatial-grid.js";
import { createMatchRuntime } from "./match-runtime.js";
import { readWorldEntities } from "./snapshot.js";
import { createWorld, type World } from "./world.js";

const UNIT = { kind: "UNIT", definitionId: "foundation_unit" } as const;

function solid(x: number, y: number, width = 1, height = 1): SpatialFootprint {
  return { anchorCell: { x, y }, width, height, blocksMovement: true, blocksBuilding: true };
}

function unitAt(world: World, x: number, y: number, playerId = 0): number {
  const entityId = world.createEntity(UNIT);
  world.positions.set(entityId, { x, y });
  world.owners.set(entityId, { ownerPlayerId: playerId });
  world.controllers.set(entityId, { controllerPlayerId: playerId });
  return entityId;
}

function occupiedCellCount(world: World): number {
  const grid = world.grid!;
  let count = 0;
  for (let y = 0; y < grid.heightCells; y += 1) {
    for (let x = 0; x < grid.widthCells; x += 1) {
      if (grid.occupantAt({ x, y }) !== null) {
        count += 1;
      }
    }
  }
  return count;
}

describe("units are not occupancy blockers", () => {
  it("moving units never change occupancy or topologyRevision", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const wall = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(wall, solid(30, 30));
    const unit = unitAt(world, -6, -3);
    const second = unitAt(world, -6, -3);
    const revision = world.topologyRevision;
    const occupied = occupiedCellCount(world);

    for (const entityId of [unit, second]) {
      world.enqueueCommand({
        actor: { playerId: 0 },
        command: {
          type: "MOVE",
          commandId: `m${entityId}`,
          entityIds: [entityId],
          target: { x: 5, y: 5 },
        },
      });
    }
    world.stepN(40);

    expect(world.positions.get(unit)).toEqual({ x: 5, y: 5 });
    expect(world.positions.get(second)).toEqual({ x: 5, y: 5 });
    expect(world.topologyRevision).toBe(revision);
    expect(occupiedCellCount(world)).toBe(occupied);
    expect(world.grid!.occupantAt(world.grid!.worldToCell({ x: 5, y: 5 }))).toBeNull();
    expect(world.grid!.isWalkable(world.grid!.worldToCell({ x: 5, y: 5 }))).toBe(true);
  });

  it("refuses a new solid footprint over a cell that currently holds a unit", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    unitAt(world, 0.5, 0.5);
    const building = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });

    expect(world.canPlaceSolidFootprint(solid(19, 19, 2, 2))).toEqual({
      ok: false,
      reason: "unit_present",
    });
    expect(world.placeSolidFootprint(building, solid(19, 19, 2, 2))).toEqual({
      ok: false,
      reason: "unit_present",
    });
    expect(world.topologyRevision).toBe(0);
    expect(world.placeSolidFootprint(building, solid(21, 21, 2, 2))).toEqual({ ok: true });
    expect(world.topologyRevision).toBe(1);
  });

  it("reports no_grid without a map", () => {
    const world = createWorld({ seed: 1 });
    expect(world.canPlaceSolidFootprint(solid(0, 0))).toEqual({ ok: false, reason: "no_grid" });
    expect(world.removeSolidFootprint(1)).toBe(false);
    expect(world.topologyRevision).toBe(0);
  });
});

describe("solid footprint lifecycle in the World", () => {
  it("destroying a footprint entity frees its cells and bumps topologyRevision once", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const building = world.createEntity({ kind: "BUILDING", definitionId: "test_wall" });
    world.placeSolidFootprint(building, solid(10, 10, 3, 1));
    expect(world.topologyRevision).toBe(1);

    world.destroyEntity(building);
    expect(world.topologyRevision).toBe(2);
    expect(world.grid!.occupantAt({ x: 11, y: 10 })).toBeNull();

    world.destroyEntity(building);
    const unit = unitAt(world, 0, 0);
    world.destroyEntity(unit);
    expect(world.topologyRevision).toBe(2);
  });

  it("supports BUILDING and RESOURCE kinds with the same generic footprint API", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const tower = world.createEntity({ kind: "BUILDING", definitionId: "tower" });
    const wood = world.createEntity({ kind: "RESOURCE", definitionId: "wood_node" });
    world.positions.set(tower, world.grid!.cellToWorldCenter({ x: 5, y: 5 }));
    world.positions.set(wood, world.grid!.footprintWorldCenter(solid(8, 8, 2, 2)));

    expect(world.placeSolidFootprint(tower, solid(5, 5))).toEqual({ ok: true });
    expect(world.placeSolidFootprint(wood, solid(8, 8, 2, 2))).toEqual({ ok: true });
    expect(world.topologyRevision).toBe(2);

    const entities = readWorldEntities(world);
    expect(entities.map(({ kind, definitionId }) => ({ kind, definitionId }))).toEqual([
      { kind: "BUILDING", definitionId: "tower" },
      { kind: "RESOURCE", definitionId: "wood_node" },
    ]);
    expect(entities[1]).toMatchObject({ x: -11, y: -11, objectiveType: null });
  });
});

describe("generic PROTECT objective", () => {
  it("targets any entity, independent of its kind or definition", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const hall = world.createEntity({ kind: "BUILDING", definitionId: "town_hall" });
    world.positions.set(hall, { x: 3, y: 3 });
    const unit = unitAt(world, 1, 1);
    const objectiveId = world.addObjective({
      type: "PROTECT",
      targetEntityId: hall,
      required: false,
      state: "ACTIVE",
    });

    expect(world.getObjective(objectiveId)).toEqual({
      type: "PROTECT",
      targetEntityId: hall,
      required: false,
      state: "ACTIVE",
    });
    const entities = readWorldEntities(world);
    expect(entities.find((entity) => entity.entityId === hall)).toMatchObject({
      kind: "BUILDING",
      definitionId: "town_hall",
      objectiveType: "PROTECT",
      objectiveState: "ACTIVE",
    });
    expect(entities.find((entity) => entity.entityId === unit)).toMatchObject({
      kind: "UNIT",
      objectiveType: null,
    });
  });

  it("keeps the objective role after its target is destroyed", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const site = world.createEntity({ kind: "OBJECTIVE", definitionId: "sacred_site" });
    const objectiveId = world.addObjective({
      type: "PROTECT",
      targetEntityId: site,
      required: true,
      state: "ACTIVE",
    });
    world.destroyEntity(site);
    expect(world.getObjective(objectiveId)?.targetEntityId).toBe(site);
  });

  it("rejects an objective whose target is not a living entity", () => {
    const world = createWorld({ seed: 1 });
    expect(() =>
      world.addObjective({ type: "PROTECT", targetEntityId: 42, required: true, state: "ACTIVE" }),
    ).toThrow(RangeError);
  });
});

describe("MatchRuntime bootstrap spatial state", () => {
  it("keeps topology stable across ticks with moving units", () => {
    const runtime = createMatchRuntime({
      seed: 3,
      mapId: "foundation",
      participants: [{ playerId: 0 }],
    });
    const before = runtime.readSnapshot();
    const unit = before.entities.find((entity) => entity.kind === "UNIT")!;
    const site = before.entities.find((entity) => entity.kind === "OBJECTIVE")!;
    expect(site).toMatchObject({
      definitionId: "sacred_site",
      x: 0,
      y: 0,
      objectiveType: "PROTECT",
    });

    runtime.submitCommand(
      { playerId: 0 },
      { type: "MOVE", commandId: "go", entityIds: [unit.entityId], target: { x: 6, y: 6 } },
    );
    for (let tick = 0; tick < 80; tick += 1) {
      runtime.step();
    }
    expect(runtime.drainEvents()).toEqual([]);
    const after = runtime.readSnapshot();
    expect(after.entities.find((entity) => entity.entityId === unit.entityId)).toMatchObject({
      x: 6,
      y: 6,
    });
    expect(after.entities.find((entity) => entity.entityId === site.entityId)).toEqual(site);
  });
});
