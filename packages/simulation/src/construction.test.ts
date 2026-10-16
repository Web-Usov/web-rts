import { describe, expect, it, vi } from "vitest";
import { ENTITY_DEFINITIONS, type MapDefinition } from "@web-rts/game-data";
import { createWorld, World } from "./world.js";
import { readWorldEntities } from "./snapshot.js";
import { spawnSoldier } from "./foundation-match.js";
import { PLAYER_TEAM, PVE_TEAM } from "./teams.js";
import { findBreachPath } from "./navigation-breach.js";
import { findPath } from "./navigation.js";
import { segmentIsTraversable } from "./navigation.js";
import { EntityPathQueryLane } from "./path-query-lane.js";
import { createMatchRuntime } from "./match-runtime.js";
import type { SimulationCommand } from "./commands.js";

const map: MapDefinition = {
  id: "construction",
  originX: 0,
  originY: 0,
  widthCells: 16,
  heightCells: 12,
  staticTerrain: [],
  playerSpawns: [],
  startingPlacements: [],
  resourcePlacements: [],
};
function worker(world: World, x = 2.5, y = 5.5, owner = 0, controller = owner) {
  const id = world.createEntity({ kind: "UNIT", definitionId: "worker" });
  world.positions.set(id, { x, y });
  world.owners.set(id, { ownerPlayerId: owner });
  world.controllers.set(id, { controllerPlayerId: controller });
  world.teams.set(id, { teamId: PLAYER_TEAM });
  world.health.set(id, { current: 60, max: 60 });
  world.workers.set(id, {
    ...ENTITY_DEFINITIONS.worker.worker,
    carried: { resourceType: "WOOD", amount: 0 },
  });
  return id;
}
function fixture(budget = 4, definition = map) {
  const world = createWorld({
    seed: 60,
    map: definition,
    pathQueriesPerTick: { commandBudget: 4, activeTaskBudget: budget, aiBudget: 1 },
  });
  const id = worker(world);
  world.playerEconomies.set(0, { resources: { WOOD: 100 } });
  world.drainEvents();
  return { world, id };
}
function queue(world: World, command: SimulationCommand, playerId = 0) {
  world.enqueueCommand({ actor: { playerId }, command });
}
function build(world: World, id: number, x = 8, y = 5, buildingTypeId = "wall", commandId = "b1") {
  queue(world, {
    type: "BUILD",
    commandId,
    builderEntityId: id,
    target: { type: "NEW", buildingTypeId, anchorCell: { x, y } },
  });
}
function resume(world: World, id: number, site: number, commandId = "resume", playerId = 0) {
  queue(
    world,
    {
      type: "BUILD",
      commandId,
      builderEntityId: id,
      target: { type: "EXISTING", constructionEntityId: site },
    },
    playerId,
  );
}
function move(world: World, id: number, x = 2.5, y = 5.5) {
  queue(world, { type: "MOVE", commandId: "move", entityIds: [id], target: { x, y } });
}
function siteId(world: World) {
  return [...world.constructions.entries()][0]![0];
}
function until(world: World, condition: () => boolean) {
  for (let n = 0; n < 250 && !condition(); n++) world.step();
  expect(condition()).toBe(true);
}
function solid(
  world: World,
  x: number,
  y: number,
  definitionId: "wall" | "town_hall" | "wood_node" = "wall",
) {
  const def = ENTITY_DEFINITIONS[definitionId];
  const id = world.createEntity({ kind: def.kind, definitionId });
  const footprint = { ...def.footprint, anchorCell: { x, y } };
  world.positions.set(id, world.grid!.footprintWorldCenter(footprint));
  expect(world.placeSolidFootprint(id, footprint).ok).toBe(true);
  return id;
}
const wood = (world: World) => world.playerEconomies.get(0)!.resources.WOOD;

describe("BUILD admission and atomicity", () => {
  it.each([
    ["invalid_building", (w: World, id: number) => build(w, id, 8, 5, "town_hall")],
    ["invalid_building", (w: World, id: number) => build(w, id, 8, 5, "__proto__")],
    [
      "insufficient_resources",
      (w: World, id: number) => {
        w.playerEconomies.get(0)!.resources.WOOD = 9;
        build(w, id);
      },
    ],
    [
      "not_your_unit",
      (w: World, id: number) => {
        w.controllers.remove(id);
        build(w, id);
      },
    ],
    [
      "invalid_owner",
      (w: World, id: number) => {
        w.owners.remove(id);
        build(w, id);
      },
    ],
    [
      "invalid_owner",
      (w: World, id: number) => {
        w.playerEconomies.clear();
        build(w, id);
      },
    ],
    [
      "not_builder",
      (w: World, id: number) => {
        w.workers.get(id)!.builder = false;
        build(w, id);
      },
    ],
    ["not_worker", (w: World) => build(w, 999)],
    ["invalid_placement", (w: World, id: number) => build(w, id, 2, 5)],
    ["invalid_placement", (w: World, id: number) => build(w, id, 16, 5)],
    ["invalid_placement", (w: World, id: number) => build(w, id, 8.5, 5)],
    ["invalid_placement", (w: World, id: number) => build(w, id, NaN, 5)],
    [
      "invalid_placement",
      (w: World, id: number) => {
        solid(w, 8, 5);
        build(w, id);
      },
    ],
  ] as const)("rejects %s without any partial mutation", (reason, attempt) => {
    const { world, id } = fixture();
    attempt(world, id);
    const before = {
      entities: readWorldEntities(world),
      wood: world.playerEconomies.get(0)?.resources.WOOD,
      ids: world.entityIds(),
      revision: world.topologyRevision,
      nav: world.readNavigation(id),
    };
    world.drainEvents();
    world.step();
    expect(world.drainEvents()).toEqual([
      expect.objectContaining({ type: "COMMAND_REJECTED", reason }),
    ]);
    expect(readWorldEntities(world)).toEqual(before.entities);
    expect(world.playerEconomies.get(0)?.resources.WOOD).toBe(before.wood);
    expect(world.entityIds()).toEqual(before.ids);
    expect(world.topologyRevision).toBe(before.revision);
    expect(world.readNavigation(id)).toEqual(before.nav);
    expect(world.buildTasks.has(id)).toBe(false);
    expect(world.createEntity({ kind: "UNIT", definitionId: "probe" })).toBe(
      Math.max(...before.ids) + 1,
    );
  });
  it("rejects a garrison host on a buildable but statically non-walkable cell, while a Wall may use it", () => {
    const terrain = [{ x: 8, y: 5, width: 1, height: 1, walkable: false, buildable: true }];
    const tower = fixture(4, { ...map, staticTerrain: terrain });
    build(tower.world, tower.id, 8, 5, "tower");
    tower.world.step();
    expect(tower.world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "COMMAND_REJECTED", reason: "invalid_placement" }),
    );
    const wall = fixture(4, { ...map, staticTerrain: terrain });
    build(wall.world, wall.id, 8, 5, "wall");
    wall.world.step();
    expect(wall.world.drainEvents()).not.toContainEqual(
      expect.objectContaining({ reason: "invalid_placement" }),
    );
  });
  it("rejects static non-buildable terrain and unreachable approaches", () => {
    for (const terrain of [
      [{ x: 8, y: 5, width: 1, height: 1, walkable: true, buildable: false }],
      [{ x: 6, y: 0, width: 1, height: 12, walkable: false, buildable: false }],
    ]) {
      const { world, id } = fixture(4, { ...map, staticTerrain: terrain });
      build(world, id);
      world.step();
      expect(world.drainEvents()).toContainEqual(
        expect.objectContaining({
          reason: terrain[0]!.x === 8 ? "invalid_placement" : "no_path",
        }),
      );
      expect(wood(world)).toBe(100);
      expect([...world.constructions.entries()].length).toBe(0);
      expect(world.topologyRevision).toBe(0);
    }
  });
  it("preflights smoothing against the future footprint, never routes through it", () => {
    const { world, id } = fixture();
    world.positions.set(id, { x: 2.5, y: 5 }); // edge touch must be checked too
    build(world, id, 6, 5);
    world.step();
    const site = siteId(world);
    const nav = world.readNavigation(id)!;
    expect(nav.pathCells).not.toContainEqual({ x: 6, y: 5 });
    let from = world.positions.get(id)!;
    for (const to of nav.waypoints) {
      expect(segmentIsTraversable(world.grid!, from, to)).toBe(true);
      from = to;
    }
    expect(world.grid!.occupantAt({ x: 6, y: 5 })).toBe(site);
  });
  it("spends/creates/registers/reserves once and blocks MOVE in the acceptance tick", () => {
    const { world, id } = fixture();
    const mover = worker(world, 8.5, 2.5);
    build(world, id);
    move(world, mover, 8.5, 5.5);
    world.step();
    const site = siteId(world);
    expect(wood(world)).toBe(90);
    expect(world.entityIds()).toHaveLength(3);
    expect([...world.buildTasks.entries()].length).toBe(1);
    expect(world.buildTasks.get(id)?.constructionEntityId).toBe(site);
    expect(world.topologyRevision).toBe(1);
    expect(world.health.get(site)).toEqual({ current: 200, max: 200 });
    expect(world.owners.get(site)?.ownerPlayerId).toBe(0);
    expect(world.teams.get(site)?.teamId).toBe(PLAYER_TEAM);
    expect(world.grid!.isWalkable({ x: 8, y: 5 })).toBe(false);
    const nav = world.readNavigation(mover)!;
    expect({ x: nav.destinationX, y: nav.destinationY }).not.toEqual({ x: 8.5, y: 5.5 });
  });
});

describe("construction lifecycle", () => {
  it.each(["wall", "tower"])(
    "%s pauses, resumes and completes without extra spend/topology; Tower gains combat capability",
    (definition) => {
      const { world, id } = fixture();
      build(world, id, 8, 5, definition);
      world.step();
      const site = siteId(world);
      until(world, () => world.constructions.get(site)!.workedTicks >= 5);
      const progress = world.constructions.get(site)!.workedTicks;
      move(world, id);
      world.stepN(25);
      expect(world.buildTasks.has(id)).toBe(false);
      expect(world.constructions.get(site)!.workedTicks).toBe(progress);
      resume(world, id, site);
      world.step();
      expect(world.buildTasks.has(id)).toBe(true);
      const before = wood(world);
      until(world, () => world.constructions.get(site)!.state === "COMPLETED");
      expect(world.buildTasks.has(id)).toBe(false);
      expect(world.movements.has(id)).toBe(false);
      expect(world.readNavigation(id)).toBeUndefined();
      expect(world.topologyRevision).toBe(1);
      expect(wood(world)).toBe(before);
      expect(world.entityIds()).toHaveLength(2);
      expect(world.attacks.has(site)).toBe(definition === "tower");
      expect(world.combats.has(site)).toBe(definition === "tower");
      resume(world, id, site);
      world.step();
      expect(world.drainEvents()).toContainEqual(
        expect.objectContaining({ reason: "invalid_construction" }),
      );
    },
  );
  it("reserves during approach; rejects busy/duplicate and friendly other-owner builders", () => {
    const { world, id } = fixture();
    const other = worker(world, 3.5, 5.5);
    const friend = worker(world, 4.5, 5.5, 7, 0);
    build(world, id);
    world.step();
    const site = siteId(world);
    world.drainEvents();
    resume(world, other, site);
    resume(world, id, site);
    resume(world, friend, site);
    world.step();
    expect(world.drainEvents().map((e) => ("reason" in e ? e.reason : e.type))).toEqual([
      "construction_busy",
      "already_building",
      "invalid_owner",
    ]);
    expect([...world.buildTasks.entries()].length).toBe(1);
    move(world, id);
    world.step();
    // Same owner but different trusted Controller is allowed.
    world.controllers.set(other, { controllerPlayerId: 9 });
    resume(world, other, site, "denied", 0);
    world.step();
    expect(world.buildTasks.has(other)).toBe(false);
    resume(world, other, site, "delegated", 9);
    world.step();
    expect(world.buildTasks.get(other)?.playerId).toBe(9);
    expect(wood(world)).toBe(90);
  });
  it("only accepted replacement commands release BUILD; BUILD preserves Wood carry", () => {
    const { world, id } = fixture();
    const node = solid(world, 10, 2, "wood_node");
    world.resourceNodes.set(node, { resourceType: "WOOD", remaining: 100 });
    const hall = solid(world, 1, 1, "town_hall");
    world.owners.set(hall, { ownerPlayerId: 0 });
    world.dropoffs.set(hall, { resourceTypes: ["WOOD"] });
    const gather = (source: number) =>
      queue(world, {
        type: "GATHER",
        commandId: "g",
        workerEntityId: id,
        resourceEntityId: source,
      });
    gather(node);
    world.step();
    world.workers.get(id)!.carried.amount = 3;
    build(world, id);
    world.step();
    const site = siteId(world);
    expect(world.gatherTasks.has(id)).toBe(false);
    expect(world.workers.get(id)!.carried.amount).toBe(3);
    const task = world.buildTasks.get(id);
    move(world, id, -1);
    gather(999);
    build(world, id, 8, 5);
    world.step();
    expect(world.buildTasks.get(id)).toBe(task);
    gather(node);
    world.step();
    expect(world.buildTasks.has(id)).toBe(false);
    expect(world.gatherTasks.has(id)).toBe(true);
    expect(world.constructions.get(site)?.state).toBe("UNDER_CONSTRUCTION");
    expect(world.topologyRevision).toBe(3);
  });
  it.each([false, true])("releases on Worker removal/death (death=%s) with no refund", (death) => {
    const { world, id } = fixture();
    build(world, id);
    world.step();
    const site = siteId(world);
    if (death) {
      world.health.get(id)!.current = 0;
      world.step();
    } else world.destroyEntity(id);
    expect(world.buildTasks.has(id)).toBe(false);
    expect(world.hasEntity(site)).toBe(true);
    expect(world.grid!.occupantAt({ x: 8, y: 5 })).toBe(site);
    expect(wood(world)).toBe(90);
    const replacement = worker(world);
    resume(world, replacement, site);
    world.step();
    expect(world.buildTasks.has(replacement)).toBe(true);
  });
  it("site combat destruction removes occupancy/task immediately with one-shot original failure", () => {
    const { world, id } = fixture();
    build(world, id);
    world.step();
    const site = siteId(world);
    const killer = spawnSoldier(world, { x: 9.5, y: 5.5 }, PVE_TEAM);
    world.health.get(site)!.current = 10;
    world.combats.get(killer)!.targetEntityId = site;
    world.drainEvents();
    world.step();
    expect(world.hasEntity(site)).toBe(false);
    expect(world.constructions.has(site)).toBe(false);
    expect(world.health.has(site)).toBe(false);
    expect(world.buildTasks.has(id)).toBe(false);
    expect(world.movements.has(id)).toBe(false);
    expect(world.grid!.occupantAt({ x: 8, y: 5 })).toBeNull();
    expect(world.topologyRevision).toBe(2);
    expect(wood(world)).toBe(90);
    expect(world.drainEvents()).toContainEqual({
      type: "ACTION_FAILED",
      commandId: "b1",
      playerId: 0,
      entityId: id,
      action: "BUILD",
      reason: "target_removed",
      tick: 1,
    });
    world.step();
    expect(world.drainEvents()).toEqual([]);
  });
  it("terminal path failure frees reservation without removing progress or footprint", () => {
    const { world, id } = fixture();
    build(world, id);
    world.step();
    const site = siteId(world);
    for (let y = 0; y < 12; y++) solid(world, 6, y);
    world.drainEvents();
    world.stepN(30);
    expect(world.buildTasks.has(id)).toBe(false);
    expect(world.constructions.get(site)!.workedTicks).toBe(0);
    expect(world.hasEntity(site)).toBe(true);
    expect(world.drainEvents()).toEqual([
      expect.objectContaining({
        type: "ACTION_FAILED",
        commandId: "b1",
        action: "BUILD",
        reason: "path_blocked",
        playerId: 0,
        entityId: id,
      }),
    ]);
    world.stepN(10);
    expect(world.drainEvents()).toEqual([]);
  });
  it("snapshot copies construction defensively", () => {
    const { world, id } = fixture();
    build(world, id);
    world.step();
    const site = siteId(world);
    readWorldEntities(world).find((e) => e.entityId === site)!.construction!.progress = 1;
    expect(world.constructions.get(site)!.workedTicks).toBe(0);
  });
});

describe("navigation integration", () => {
  it("Wall invalidates real MOVE route before displacement", () => {
    const { world, id } = fixture();
    const mover = worker(world, 3.5, 5.5);
    move(world, mover, 12.5, 5.5);
    world.step();
    build(world, id, 7, 5);
    world.step();
    const visited: number[] = [];
    for (let n = 0; n < 50; n++) {
      const before = { ...world.positions.get(mover)! };
      world.step();
      const after = world.positions.get(mover)!;
      expect(segmentIsTraversable(world.grid!, before, after)).toBe(true);
      expect(world.grid!.worldToCell(after)).not.toEqual({ x: 7, y: 5 });
      visited.push(after.y);
    }
    expect(visited.some((y) => y !== 5.5)).toBe(true);
    expect(world.positions.get(mover)).toEqual({ x: 12.5, y: 5.5 });
  });
  it("shares scarce ascending-id lane across BUILD, GATHER, Soldier and MOVE", () => {
    const { world, id } = fixture(1);
    const gatherer = worker(world, 2.5, 8.5);
    const soldier = spawnSoldier(world, { x: 9.5, y: 8.5 }, PLAYER_TEAM);
    const mover = worker(world, 3.5, 10.5);
    const target = spawnSoldier(world, { x: 13.5, y: 8.5 }, PVE_TEAM);
    world.attacks.remove(target);
    const node = solid(world, 8, 10, "wood_node");
    world.resourceNodes.set(node, { resourceType: "WOOD", remaining: 100 });
    const hall = solid(world, 1, 1, "town_hall");
    world.owners.set(hall, { ownerPlayerId: 0 });
    world.dropoffs.set(hall, { resourceTypes: ["WOOD"] });
    build(world, id);
    queue(world, {
      type: "GATHER",
      commandId: "g",
      workerEntityId: gatherer,
      resourceEntityId: node,
    });
    move(world, mover, 12.5, 10.5);
    world.step();
    const site = siteId(world);
    solid(world, 6, 10);
    world.stopNavigation(id);
    world.stopNavigation(gatherer);
    world.positions.set(target, { x: 14.5, y: 8.5 });
    const before = { ...world.positions.get(gatherer)! };
    const spy = vi.spyOn(EntityPathQueryLane.prototype, "tryReserve");
    world.step();
    expect(spy.mock.calls.map(([entity]) => entity)).toEqual([id, gatherer, soldier, mover]);
    spy.mockRestore();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    expect(world.positions.get(gatherer)).toEqual(before);
    expect(world.buildTasks.get(id)?.constructionEntityId).toBe(site);
    expect(world.gatherTasks.has(gatherer)).toBe(true);
    world.step(); // existing BUILD route uses no query; GATHER now receives budget
    expect(world.positions.get(gatherer)).not.toEqual(before);
  });
  it("exhaustion defers BUILD replan and retains its reservation", () => {
    const { world, id } = fixture(1);
    const second = worker(world, 2.5, 8.5);
    build(world, id, 8, 5);
    build(world, second, 8, 8, "wall", "b2");
    world.step();
    world.stopNavigation(id);
    world.stopNavigation(second);
    const task = world.buildTasks.get(second)!;
    const before = { ...world.positions.get(second)! };
    world.step();
    expect(world.buildTasks.get(second)).toBe(task);
    expect(world.positions.get(second)).toEqual(before);
    resume(world, id, task.constructionEntityId);
    world.step();
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ reason: "construction_busy" }),
    );
    expect(world.positions.get(second)).not.toEqual(before);
  });
});

it("shared runtime schedules conflicting BUILD deterministically and reports recipient failures", () => {
  const original = World.prototype.step;
  let current: World | undefined;
  const spy = vi.spyOn(World.prototype, "step").mockImplementation(function (this: World) {
    current = spy.mock.contexts.at(-1);
    original.call(this);
  });
  try {
    const runtime = createMatchRuntime({
      seed: 60,
      mapId: "foundation",
      participants: [{ playerId: 9 }, { playerId: 2 }],
    });
    runtime.step();
    for (const id of [2, 9]) current!.playerEconomies.set(id, { resources: { WOOD: 100 } });
    const workers = runtime.readSnapshot().entities.filter((e) => e.worker);
    const submit = (playerId: number) =>
      runtime.submitCommand(
        { playerId },
        {
          type: "BUILD",
          commandId: `build-${playerId}`,
          builderEntityId: workers.find((e) => e.ownerPlayerId === playerId)!.entityId,
          target: { type: "NEW", buildingTypeId: "wall", anchorCell: { x: 20, y: 10 } },
        },
      );
    submit(2);
    submit(9);
    runtime.step();
    expect(runtime.readMetrics().reservedCommandPathCost).toBe(2);
    const constructions = runtime.readSnapshot().entities.filter((e) => e.construction);
    expect(constructions).toHaveLength(1);
    expect(constructions[0]!.ownerPlayerId).toBe(9); // cursor rotated after prior tick
    expect(runtime.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: "COMMAND_REJECTED",
        recipientPlayerId: 2,
        reason: "invalid_placement",
      }),
    );
    current!.destroyEntity(constructions[0]!.entityId);
    runtime.step();
    expect(runtime.drainEvents()).toEqual([
      expect.objectContaining({
        type: "ACTION_FAILED",
        recipientPlayerId: 9,
        commandId: "build-9",
        action: "BUILD",
        reason: "target_removed",
      }),
    ]);
    runtime.step();
    expect(runtime.drainEvents()).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

it("rejects a footprint occupied by another live unit", () => {
  const { world, id } = fixture();
  worker(world, 8.5, 5.5);
  build(world, id);
  world.step();
  expect(world.drainEvents()).toContainEqual(
    expect.objectContaining({ reason: "invalid_placement" }),
  );
  expect(wood(world)).toBe(100);
  expect(world.topologyRevision).toBe(0);
});

it("rejects unreachable EXISTING without a spend/reset/reservation or cancelling another BUILD", () => {
  const { world, id } = fixture();
  build(world, id);
  world.step();
  const first = siteId(world);
  until(world, () => world.constructions.get(first)!.workedTicks === 3);
  move(world, id);
  world.stepN(20);
  const progress = world.constructions.get(first)!.workedTicks;
  for (let y = 0; y < 12; y++) solid(world, 6, y);
  build(world, id, 4, 8, "wall", "replacement");
  world.step();
  const active = world.buildTasks.get(id);
  const before = wood(world),
    revision = world.topologyRevision;
  resume(world, id, first);
  world.step();
  expect(world.drainEvents()).toContainEqual(
    expect.objectContaining({ commandId: "resume", reason: "no_path" }),
  );
  expect(world.buildTasks.get(id)).toBe(active);
  expect(world.constructions.get(first)!.workedTicks).toBe(progress);
  expect(wood(world)).toBe(before);
  expect(world.topologyRevision).toBe(revision);
  expect([...world.constructions.entries()]).toHaveLength(2);
});

it("under-construction Wall closes a choke and remains a hostile breachable Health target", () => {
  const { world, id } = fixture(4, {
    ...map,
    staticTerrain: [
      { x: 0, y: 0, width: 16, height: 5, walkable: false, buildable: false },
      { x: 0, y: 6, width: 16, height: 6, walkable: false, buildable: false },
    ],
  });
  const start = { x: 2, y: 5 },
    goal = { x: 12, y: 5 };
  expect(findPath(world.grid!, start, [goal])).not.toBeNull();
  build(world, id, 8, 5);
  world.step();
  const site = siteId(world);
  expect(findPath(world.grid!, start, [goal])).toBeNull();
  const route = findBreachPath(
    world.grid!,
    start,
    [goal],
    (target) =>
      (world.health.get(target)?.current ?? 0) > 0 &&
      world.relationships.resolve(PVE_TEAM, world.teams.get(target)?.teamId) === "HOSTILE",
  );
  expect(route).toMatchObject({ status: "found", firstBlockerEntityId: site });
  const revision = world.topologyRevision;
  world.destroyEntity(site);
  expect(world.topologyRevision).toBe(revision + 1);
  expect(findPath(world.grid!, start, [goal])).not.toBeNull();
});
