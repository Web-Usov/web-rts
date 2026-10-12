import { describe, expect, it, vi } from "vitest";
import { ENTITY_DEFINITIONS, type MapDefinition } from "@web-rts/game-data";
import { createWorld, World } from "./world.js";
import { spawnSoldier } from "./foundation-match.js";
import { PLAYER_TEAM, PVE_TEAM } from "./teams.js";
import { EntityPathQueryLane } from "./path-query-lane.js";
import { segmentIsTraversable } from "./navigation.js";
import { readWorldEntities } from "./snapshot.js";
import { createMatchRuntime } from "./match-runtime.js";

const map: MapDefinition = {
  id: "economy-test",
  originX: 0,
  originY: 0,
  widthCells: 16,
  heightCells: 12,
  staticTerrain: [],
  playerSpawns: [],
  startingPlacements: [],
  resourcePlacements: [],
};
function solid(
  world: World,
  definitionId: "wood_node" | "town_hall",
  x: number,
  y: number,
  owner = 0,
): number {
  const def = ENTITY_DEFINITIONS[definitionId];
  const id = world.createEntity({ kind: def.kind, definitionId });
  const footprint = { ...def.footprint, anchorCell: { x, y } };
  world.positions.set(id, world.grid!.footprintWorldCenter(footprint));
  expect(world.placeSolidFootprint(id, footprint).ok).toBe(true);
  if (definitionId === "wood_node")
    world.resourceNodes.set(id, { resourceType: "WOOD", remaining: 23 });
  else {
    world.owners.set(id, { ownerPlayerId: owner });
    world.teams.set(id, { teamId: PLAYER_TEAM });
    world.health.set(id, { current: def.maxHealth!, max: def.maxHealth! });
    world.dropoffs.set(id, { resourceTypes: ["WOOD"] });
  }
  return id;
}
function worker(world: World, x = 2.5, y = 5.5, owner = 0, controller = owner): number {
  const id = world.createEntity({ kind: "UNIT", definitionId: "worker" });
  world.positions.set(id, { x, y });
  world.owners.set(id, { ownerPlayerId: owner });
  world.controllers.set(id, { controllerPlayerId: controller });
  world.teams.set(id, { teamId: PLAYER_TEAM });
  world.health.set(id, {
    current: ENTITY_DEFINITIONS.worker.maxHealth,
    max: ENTITY_DEFINITIONS.worker.maxHealth,
  });
  world.workers.set(id, {
    moveSpeed: 5,
    carryCapacity: 10,
    gatherRate: 5,
    carried: { resourceType: "WOOD", amount: 0 },
  });
  if (!world.playerEconomies.has(owner))
    world.playerEconomies.set(owner, { resources: { WOOD: 0 } });
  return id;
}
function fixture(budget = 4) {
  const world = createWorld({
    seed: 17,
    map,
    pathQueriesPerTick: { commandBudget: 4, activeTaskBudget: budget, aiBudget: 1 },
  });
  const id = worker(world);
  const source = solid(world, "wood_node", 8, 5);
  const hall = solid(world, "town_hall", 1, 1);
  world.drainEvents();
  return { world, id, source, hall };
}
function gather(world: World, id: number, source: number, commandId = "g1", playerId = 0) {
  world.enqueueCommand({
    actor: { playerId },
    command: { type: "GATHER", commandId, workerEntityId: id, resourceEntityId: source },
  });
}
function until(world: World, predicate: () => boolean, max = 800) {
  for (let i = 0; i < max && !predicate(); i++) world.step();
  expect(predicate()).toBe(true);
}
function move(world: World, id: number) {
  world.enqueueCommand({
    actor: { playerId: 0 },
    command: { type: "MOVE", commandId: "m1", entityIds: [id], target: { x: 13.5, y: 9.5 } },
  });
}
const wood = (world: World, playerId = 0) => world.playerEconomies.get(playerId)!.resources.WOOD;

describe("G5 authoritative economy", () => {
  it("repeats the same source, conserves finite Wood each tick, deposits partial final load exactly once", () => {
    const { world, id, source } = fixture();
    const alternate = solid(world, "wood_node", 12, 2);
    gather(world, id, source);
    world.step();
    let maxCarry = 0;
    for (let i = 0; i < 700; i++) {
      world.step();
      const carry = world.workers.get(id)!.carried.amount;
      maxCarry = Math.max(maxCarry, carry);
      expect(carry).toBeGreaterThanOrEqual(0);
      expect(carry).toBeLessThanOrEqual(10);
      expect(carry + wood(world) + world.resourceNodes.get(source)!.remaining).toBe(23);
      const task = world.gatherTasks.get(id);
      if (task) expect(task.sourceEntityId).toBe(source);
    }
    expect(maxCarry).toBe(10);
    expect(wood(world)).toBe(23);
    expect(world.resourceNodes.get(source)!.remaining).toBe(0);
    expect(world.resourceNodes.get(alternate)!.remaining).toBe(23);
    expect(world.gatherTasks.has(id)).toBe(false);
    world.stepN(100);
    expect(wood(world)).toBe(23);
  });
  it("uses tick rate and a fractional accumulator, with no rounding-created resources", () => {
    const { world, id, source } = fixture();
    world.workers.get(id)!.gatherRate = 3;
    gather(world, id, source);
    until(world, () => world.gatherTasks.get(id)?.phase === "GATHERING");
    world.stepN(9);
    expect(world.workers.get(id)!.carried.amount).toBe(2);
    world.step();
    expect(world.workers.get(id)!.carried.amount).toBe(3);
    expect(world.resourceNodes.get(source)!.remaining).toBe(20);
  });
  it("two Workers compete deterministically for a shared finite node", () => {
    const { world, id, source } = fixture();
    const second = worker(world, 3.5, 5.5);
    gather(world, id, source);
    gather(world, second, source, "g2");
    world.stepN(800);
    expect(wood(world)).toBe(23);
    expect(world.workers.get(id)!.carried.amount + world.workers.get(second)!.carried.amount).toBe(
      0,
    );
    expect(world.gatherTasks.has(id) || world.gatherTasks.has(second)).toBe(false);
  });
  it("depletion before arrival becomes IDLE; depletion while carrying still makes the final deposit", () => {
    for (const carrying of [false, true]) {
      const { world, id, source } = fixture();
      gather(world, id, source);
      world.step();
      if (carrying) until(world, () => world.workers.get(id)!.carried.amount > 0);
      const load = world.workers.get(id)!.carried.amount;
      world.resourceNodes.get(source)!.remaining = 0;
      world.stepN(150);
      expect(world.gatherTasks.has(id)).toBe(false);
      expect(wood(world)).toBe(load);
    }
  });
  it("rejects a missing drop-off on the tick boundary without partially replacing MOVE", () => {
    const { world, id, source, hall } = fixture();
    move(world, id);
    world.step();
    const oldDestination = world.readNavigation(id);
    gather(world, id, source);
    world.destroyEntity(hall);
    world.step();
    expect(world.readNavigation(id)?.destinationX).toBe(oldDestination?.destinationX);
    expect(world.drainEvents()).toContainEqual({
      type: "COMMAND_REJECTED",
      commandId: "g1",
      playerId: 0,
      reason: "no_dropoff",
      tick: 1,
    });
  });
  it("a rejected replacement GATHER preserves the original task and carry", () => {
    const { world, id, source } = fixture();
    gather(world, id, source);
    until(world, () => world.workers.get(id)!.carried.amount > 0);
    const task = world.gatherTasks.get(id);
    gather(world, id, 999, "bad");
    world.step();
    expect(world.gatherTasks.get(id)).toBe(task);
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: "COMMAND_REJECTED",
        commandId: "bad",
        reason: "invalid_resource",
      }),
    );
  });
  it.each(["TO_SOURCE", "TO_DROPOFF"] as const)(
    "drop-off destruction in %s emits one ACTION_FAILED and retains carried Wood",
    (phase) => {
      const { world, id, source, hall } = fixture();
      gather(world, id, source);
      until(world, () => world.gatherTasks.get(id)?.phase === phase);
      const alternative = solid(world, "town_hall", 12, 8);
      const load = world.workers.get(id)!.carried.amount;
      world.drainEvents();
      world.destroyEntity(hall);
      world.stepN(100);
      expect(world.gatherTasks.has(id)).toBe(false);
      expect(world.workers.get(id)!.carried.amount).toBe(load);
      expect(wood(world)).toBe(0);
      expect(world.hasEntity(alternative)).toBe(true);
      expect(world.drainEvents()).toEqual([
        {
          type: "ACTION_FAILED",
          commandId: "g1",
          playerId: 0,
          entityId: id,
          action: "GATHER",
          reason: "no_dropoff",
          tick: phase === "TO_SOURCE" ? 1 : world.tick - 100,
        },
      ]);
    },
  );
  it.each(["GATHERING", "TO_DROPOFF"] as const)(
    "accepted MOVE overrides %s without deleting carry",
    (phase) => {
      const { world, id, source } = fixture();
      gather(world, id, source);
      until(world, () => world.gatherTasks.get(id)?.phase === phase);
      const load = world.workers.get(id)!.carried.amount;
      const remaining = world.resourceNodes.get(source)!.remaining;
      move(world, id);
      world.stepN(50);
      expect(world.gatherTasks.has(id)).toBe(false);
      expect(world.workers.get(id)!.carried.amount).toBe(load);
      expect(world.resourceNodes.get(source)!.remaining).toBe(remaining);
      expect(wood(world)).toBe(0);
    },
  );
  it("Controller grants permission, while Worker Owner chooses drop-off and credited economy", () => {
    const { world, id, source } = fixture();
    world.controllers.set(id, { controllerPlayerId: 7 });
    world.playerEconomies.set(7, { resources: { WOOD: 0 } });
    gather(world, id, source, "wrong", 0);
    world.step();
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "COMMAND_REJECTED", reason: "not_your_unit" }),
    );
    gather(world, id, source, "right", 7);
    world.stepN(800);
    expect(wood(world, 0)).toBe(23);
    expect(wood(world, 7)).toBe(0);
  });
  it("ignores another owner's closer Hall and fails when selected Hall changes owner/capability", () => {
    for (const change of ["owner", "capability"] as const) {
      const { world, id, source, hall } = fixture();
      solid(world, "town_hall", 5, 3, 9);
      gather(world, id, source);
      world.step();
      expect(world.gatherTasks.get(id)!.dropoffEntityId).toBe(hall);
      if (change === "owner") world.owners.set(hall, { ownerPlayerId: 9 });
      else world.dropoffs.remove(hall);
      world.step();
      expect(world.drainEvents()).toContainEqual(
        expect.objectContaining({ type: "ACTION_FAILED", reason: "no_dropoff" }),
      );
    }
  });
  it("nearest reachable navigation distance wins, followed by stable entity and goal ties", () => {
    const { world, id, source, hall } = fixture();
    world.destroyEntity(hall);
    world.positions.set(id, { x: 7.5, y: 5.5 });
    const first = solid(world, "town_hall", 3, 4);
    const second = solid(world, "town_hall", 10, 4);
    gather(world, id, source);
    world.step();
    expect(world.gatherTasks.get(id)!.dropoffEntityId).toBe(first);
    world.destroyEntity(first);
    gather(world, id, source, "next");
    world.step();
    expect(world.gatherTasks.get(id)!.dropoffEntityId).toBe(second);
  });
  it("rejects no path; a stopped movement never implies deposit", () => {
    const { world, id, source } = fixture();
    for (let y = 0; y < 12; y++) solid(world, "wood_node", 6, y);
    gather(world, id, source);
    world.step();
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "COMMAND_REJECTED", reason: "no_path" }),
    );
    expect(world.gatherTasks.has(id)).toBe(false);
    expect(wood(world)).toBe(0);
  });
  it("topology invalidation fails an accepted task, preserves carry and emits path_blocked", () => {
    const { world, id, source } = fixture();
    gather(world, id, source);
    until(world, () => world.gatherTasks.get(id)?.phase === "TO_DROPOFF");
    const load = world.workers.get(id)!.carried.amount;
    // Isolate Town Hall, not the worker's current cell.
    for (let x = 0; x < 5; x++) solid(world, "wood_node", x, 4);
    for (let y = 0; y < 4; y++) solid(world, "wood_node", 4, y);
    world.stepN(60);
    expect(wood(world)).toBe(0);
    expect(world.workers.get(id)!.carried.amount).toBe(load);
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "ACTION_FAILED", reason: "path_blocked", commandId: "g1" }),
    );
  });
  it("shares ascending entity lane between transitions and replans; exhaustion safely defers", () => {
    const { world, id, source } = fixture(1);
    const second = worker(world, 3.5, 5.5);
    gather(world, id, source);
    gather(world, second, source, "g2");
    until(
      world,
      () =>
        world.workers.get(id)!.carried.amount > 0 && world.workers.get(second)!.carried.amount > 0,
    );
    world.workers.get(id)!.carryCapacity = world.workers.get(id)!.carried.amount;
    world.workers.get(second)!.carryCapacity = world.workers.get(second)!.carried.amount;
    world.step();
    const secondPosition = { ...world.positions.get(second)! };
    world.step();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    expect(world.positions.get(second)).toEqual(secondPosition);
    expect(world.gatherTasks.get(second)?.phase).toBe("TO_DROPOFF");
    world.step();
    expect(world.positions.get(second)).not.toEqual(secondPosition);
    world.stepN(50);
    expect(wood(world)).toBeGreaterThan(0);
  });
  it("target removal fails when empty; when carrying finishes deposit and stops", () => {
    for (const carrying of [false, true]) {
      const { world, id, source } = fixture();
      gather(world, id, source);
      world.step();
      if (carrying) until(world, () => world.workers.get(id)!.carried.amount > 0);
      const load = world.workers.get(id)!.carried.amount;
      world.destroyEntity(source);
      world.stepN(100);
      expect(wood(world)).toBe(load);
      expect(world.gatherTasks.has(id)).toBe(false);
      if (!carrying)
        expect(world.drainEvents()).toContainEqual(
          expect.objectContaining({ type: "ACTION_FAILED", reason: "target_removed" }),
        );
    }
  });
  it("deterministic setup/commands/ticks produces identical snapshots/events, with defensive copies", () => {
    const runs = [fixture(), fixture()];
    for (const { world, id, source } of runs) {
      gather(world, id, source);
      world.stepN(200);
    }
    expect(readWorldEntities(runs[0]!.world)).toEqual(readWorldEntities(runs[1]!.world));
    expect(runs[0]!.world.drainEvents()).toEqual(runs[1]!.world.drainEvents());
    const entities = readWorldEntities(runs[0]!.world);
    const read = entities.find((e) => e.worker)!;
    read.worker!.carried.amount = 999;
    expect(runs[0]!.world.workers.get(read.entityId)!.carried.amount).not.toBe(999);
  });
});

describe("G5 shared MatchRuntime", () => {
  it("bootstraps one Worker/Hall per sorted player and finite nodes; snapshots and events are repeatable", () => {
    const setup = {
      seed: 11,
      mapId: "foundation",
      participants: [{ playerId: 9 }, { playerId: 2 }],
    };
    const runtimes = [createMatchRuntime(setup), createMatchRuntime(setup)];
    for (const runtime of runtimes) {
      const snapshot = runtime.readSnapshot();
      expect(snapshot.entities.filter((e) => e.definitionId === "town_hall")).toHaveLength(2);
      expect(snapshot.entities.filter((e) => e.worker)).toHaveLength(2);
      expect(snapshot.playerEconomies.map((e) => e.playerId)).toEqual([2, 9]);
      const worker = snapshot.entities.find((e) => e.worker && e.ownerPlayerId === 2)!;
      const source = snapshot.entities.find((e) => e.resourceNode)!;
      runtime.submitCommand(
        { playerId: 2 },
        {
          type: "GATHER",
          commandId: "runtime",
          workerEntityId: worker.entityId,
          resourceEntityId: source.entityId,
        },
      );
      for (let i = 0; i < 1400; i++) runtime.step();
      expect(
        runtime.readSnapshot().playerEconomies.find((e) => e.playerId === 2)!.resources.WOOD,
      ).toBe(100);
      expect(runtime.readMetrics().pendingCommandCount).toBe(0);
    }
    expect(runtimes[0]!.readSnapshot()).toEqual(runtimes[1]!.readSnapshot());
    expect(runtimes[0]!.drainEvents()).toEqual(runtimes[1]!.drainEvents());
    const snapshot = runtimes[0]!.readSnapshot();
    snapshot.playerEconomies[0]!.resources.WOOD = 12345;
    expect(runtimes[0]!.readSnapshot().playerEconomies[0]!.resources.WOOD).toBe(100);
  });
  it("GATHER costs one command query and rejection carries recipient metadata", () => {
    const runtime = createMatchRuntime({
      seed: 2,
      mapId: "foundation",
      participants: [{ playerId: 1 }],
    });
    runtime.submitCommand(
      { playerId: 1 },
      { type: "GATHER", commandId: "invalid", workerEntityId: 999, resourceEntityId: 888 },
    );
    runtime.step();
    expect(runtime.readMetrics().reservedCommandPathCost).toBe(1);
    expect(runtime.drainEvents()).toEqual([
      {
        type: "COMMAND_REJECTED",
        recipientPlayerId: 1,
        commandId: "invalid",
        reason: "not_worker",
        tick: 0,
      },
    ]);
    expect(runtime.drainEvents()).toEqual([]);
  });
});

it("chooses reachable path distance instead of geometric proximity", () => {
  const { world, id, source, hall } = fixture();
  world.destroyEntity(hall);
  // Complete wall makes the closer left Hall unreachable; source and Worker are right.
  for (let y = 0; y < 12; y++) solid(world, "wood_node", 4, y);
  world.positions.set(id, { x: 6.5, y: 5.5 });
  solid(world, "town_hall", 1, 4);
  const reachable = solid(world, "town_hall", 12, 8);
  gather(world, id, source);
  world.step();
  expect(world.gatherTasks.get(id)!.dropoffEntityId).toBe(reachable);
});

it("can explicitly resume with preserved carry after loss of drop-off", () => {
  const { world, id, source, hall } = fixture();
  gather(world, id, source);
  until(world, () => world.workers.get(id)!.carried.amount === 10);
  world.destroyEntity(hall);
  world.step();
  expect(world.workers.get(id)!.carried.amount).toBe(10);
  solid(world, "town_hall", 1, 1);
  gather(world, id, source, "resume");
  world.step();
  expect(world.gatherTasks.get(id)?.phase).toBe("TO_DROPOFF");
  world.stepN(800);
  expect(wood(world)).toBe(23);
  expect(world.workers.get(id)!.carried.amount).toBe(0);
});

it("MatchRuntime forwards accepted-task failure with its original command, entity and recipient", () => {
  const original = World.prototype.step;
  const spy = vi.spyOn(World.prototype, "step").mockImplementation(function (this: World) {
    original.call(this);
  });
  try {
    const runtime = createMatchRuntime({
      seed: 17,
      mapId: "foundation",
      participants: [{ playerId: 3 }],
    });
    const snapshot = runtime.readSnapshot();
    const unit = snapshot.entities.find((entity) => entity.worker)!;
    const source = snapshot.entities.find((entity) => entity.resourceNode)!;
    const hall = snapshot.entities.find((entity) => entity.definitionId === "town_hall")!;
    runtime.submitCommand(
      { playerId: 3 },
      {
        type: "GATHER",
        commandId: "long-running",
        workerEntityId: unit.entityId,
        resourceEntityId: source.entityId,
      },
    );
    runtime.step();
    expect(runtime.drainEvents()).toEqual([]);
    spy.mock.contexts[0]!.destroyEntity(hall.entityId);
    runtime.step();
    expect(runtime.drainEvents()).toEqual([
      {
        type: "ACTION_FAILED",
        recipientPlayerId: 3,
        commandId: "long-running",
        entityId: unit.entityId,
        action: "GATHER",
        reason: "no_dropoff",
        tick: 1,
      },
    ]);
    runtime.step();
    expect(runtime.drainEvents()).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

it("all four production spawn slots have exactly one owned Hall and controlled Worker", () => {
  const runtime = createMatchRuntime({
    seed: 3,
    mapId: "foundation",
    participants: [{ playerId: 4 }, { playerId: 1 }, { playerId: 8 }, { playerId: 2 }],
  });
  const snapshot = runtime.readSnapshot();
  for (const playerId of [1, 2, 4, 8]) {
    expect(
      snapshot.entities.filter(
        (entity) => entity.definitionId === "town_hall" && entity.ownerPlayerId === playerId,
      ),
    ).toHaveLength(1);
    expect(
      snapshot.entities.filter(
        (entity) =>
          entity.worker &&
          entity.ownerPlayerId === playerId &&
          entity.controllerPlayerId === playerId,
      ),
    ).toHaveLength(1);
  }
  expect(snapshot.entities.filter((entity) => entity.resourceNode?.remaining === 100)).toHaveLength(
    4,
  );
});

describe("G5 + G6 integration", () => {
  it("gathers and deposits while a Soldier independently chases and fights", () => {
    const { world, id, source } = fixture();
    const soldier = spawnSoldier(world, { x: 9.5, y: 8.5 }, PLAYER_TEAM);
    const enemy = spawnSoldier(world, { x: 13.5, y: 8.5 }, PVE_TEAM);
    gather(world, id, source);
    world.stepN(150);
    expect(wood(world)).toBeGreaterThan(0);
    expect(world.resourceNodes.get(source)!.remaining).toBeLessThan(23);
    expect(world.hasEntity(enemy)).toBe(false);
    expect(world.hasEntity(soldier)).toBe(true);
    expect(world.health.get(id)!.current).toBe(ENTITY_DEFINITIONS.worker.maxHealth);
  });

  it.each([false, true])(
    "shares ascending-id scarce budget (Soldier created first: %s)",
    (soldierFirst) => {
      const world = createWorld({
        seed: 59,
        map,
        pathQueriesPerTick: { commandBudget: 4, activeTaskBudget: 1, aiBudget: 1 },
      });
      let soldier: number;
      let id: number;
      if (soldierFirst) {
        soldier = spawnSoldier(world, { x: 9.5, y: 8.5 }, PLAYER_TEAM);
        id = worker(world);
      } else {
        id = worker(world);
        soldier = spawnSoldier(world, { x: 9.5, y: 8.5 }, PLAYER_TEAM);
      }
      const source = solid(world, "wood_node", 8, 5);
      solid(world, "town_hall", 1, 1);
      const enemy = spawnSoldier(world, { x: 13.5, y: 8.5 }, PVE_TEAM);
      world.attacks.remove(enemy); // stationary target; no second autonomous planner
      gather(world, id, source);
      world.step();
      world.stopNavigation(id);
      world.positions.set(enemy, { x: 14.5, y: 8.5 });
      const before = new Map(
        [id, soldier].map((entity) => [entity, { ...world.positions.get(entity)! }]),
      );
      const reserve = vi.spyOn(EntityPathQueryLane.prototype, "tryReserve");
      world.step();
      expect(reserve.mock.calls.map(([entity]) => entity)).toEqual(
        [id, soldier].sort((a, b) => a - b),
      );
      reserve.mockRestore();
      expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
      const deferred = Math.max(id, soldier);
      expect(world.positions.get(deferred)).toEqual(before.get(deferred));
      expect(world.gatherTasks.has(id)).toBe(true);
      expect(world.soldiers.get(soldier)!.state).toBe("ENGAGING");
      world.step();
      expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
      for (const entity of [id, soldier]) {
        expect(
          segmentIsTraversable(world.grid!, before.get(entity)!, world.positions.get(entity)!),
        ).toBe(true);
      }
    },
  );

  it("does not attack friendly Worker/Town Hall or neutral Wood; hostile Soldier damages both destructible types", () => {
    const { world, id, source, hall } = fixture();
    const friendly = spawnSoldier(world, { x: 2.5, y: 5 }, PLAYER_TEAM);
    world.stepN(20);
    expect(world.soldiers.get(friendly)!.state).toBe("IDLE");
    expect(world.health.get(id)!.current).toBe(ENTITY_DEFINITIONS.worker.maxHealth);
    expect(world.health.get(hall)!.current).toBe(ENTITY_DEFINITIONS.town_hall.maxHealth);
    expect(world.teams.has(source)).toBe(false);
    expect(world.health.has(source)).toBe(false);
    world.destroyEntity(friendly);
    const hostile = spawnSoldier(world, { x: 2.5, y: 5 }, PVE_TEAM);
    world.step();
    expect(world.health.get(id)!.current).toBe(
      ENTITY_DEFINITIONS.worker.maxHealth - ENTITY_DEFINITIONS.soldier.attack.damage,
    );
    world.destroyEntity(id);
    world.positions.set(hostile, { x: 3.5, y: 2.5 });
    world.stepN(10);
    expect(world.health.get(hall)!.current).toBe(
      ENTITY_DEFINITIONS.town_hall.maxHealth - ENTITY_DEFINITIONS.soldier.attack.damage,
    );
    expect(world.resourceNodes.get(source)!.remaining).toBe(23);
  });

  it("lethal damage to a carrying Worker clears both subsystems and never deposits its carry", () => {
    const { world, id, source } = fixture();
    gather(world, id, source);
    until(world, () => world.workers.get(id)!.carried.amount > 0);
    const position = world.positions.get(id)!;
    const killer = spawnSoldier(world, { x: position.x, y: position.y + 0.5 }, PVE_TEAM);
    world.health.get(id)!.current = 10;
    world.soldiers
      .get(killer)!
      .unreachable.set(id, { cellId: 0, revision: world.topologyRevision });
    world.combats.get(killer)!.targetEntityId = id;
    world.step();
    expect(world.hasEntity(id)).toBe(false);
    for (const store of [
      world.identities,
      world.positions,
      world.workers,
      world.gatherTasks,
      world.movements,
      world.teams,
      world.health,
      world.attacks,
      world.combats,
      world.soldiers,
    ])
      expect(store.has(id)).toBe(false);
    expect(world.readNavigation(id)).toBeUndefined();
    expect(world.soldiers.get(killer)!.unreachable.has(id)).toBe(false);
    expect(world.combats.get(killer)!.targetEntityId).toBeNull();
    world.stepN(100);
    expect(wood(world)).toBe(0);
  });

  it("lethal Town Hall damage fails GATHER with no_dropoff, preserves carry and removes footprint", () => {
    const { world, id, source, hall } = fixture();
    gather(world, id, source);
    until(world, () => world.workers.get(id)!.carried.amount > 0);
    const carry = world.workers.get(id)!.carried.amount;
    const killer = spawnSoldier(world, { x: 3.5, y: 2.5 }, PVE_TEAM);
    world.health.get(hall)!.current = 10;
    world.step();
    expect(world.hasEntity(hall)).toBe(false);
    expect(world.dropoffs.has(hall)).toBe(false);
    expect(world.health.has(hall)).toBe(false);
    expect(world.teams.has(hall)).toBe(false);
    expect(world.grid!.footprintOf(hall)).toBeUndefined();
    world.drainEvents();
    world.step(); // Worker processes invalidated pinned drop-off in the next ascending pass
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "ACTION_FAILED", entityId: id, reason: "no_dropoff" }),
    );
    expect(world.gatherTasks.has(id)).toBe(false);
    expect(world.workers.get(id)!.carried.amount).toBeGreaterThanOrEqual(carry);
    const preserved = world.workers.get(id)!.carried.amount;
    world.destroyEntity(killer);
    world.stepN(100);
    expect(world.workers.get(id)!.carried.amount).toBe(preserved);
    expect(wood(world)).toBe(0);
  });
});

it("keeps both tasks on rejected MOVE/GATHER and cancels both only on accepted group MOVE", () => {
  const { world, id, source } = fixture();
  const soldier = spawnSoldier(world, { x: 9.5, y: 8.5 }, PLAYER_TEAM);
  world.controllers.set(soldier, { controllerPlayerId: 0 });
  const enemy = spawnSoldier(world, { x: 13.5, y: 8.5 }, PVE_TEAM);
  world.attacks.remove(enemy);
  gather(world, id, source);
  world.step();
  const task = world.gatherTasks.get(id);
  world.workers.get(id)!.carried.amount = 3;
  world.enqueueCommand({
    actor: { playerId: 0 },
    command: {
      type: "MOVE",
      commandId: "rejected-group",
      entityIds: [id, soldier, source],
      target: { x: 12.5, y: 10.5 },
    },
  });
  gather(world, soldier, source, "not-worker");
  gather(world, id, soldier, "invalid-resource");
  world.step();
  expect(world.gatherTasks.get(id)).toBe(task);
  expect(world.soldiers.get(soldier)!.targetEntityId).toBe(enemy);
  expect(
    world
      .drainEvents()
      .filter((e) => e.type === "COMMAND_REJECTED")
      .map((e) => e.reason),
  ).toEqual(["not_your_unit", "not_worker", "invalid_resource"]);
  world.enqueueCommand({
    actor: { playerId: 0 },
    command: {
      type: "MOVE",
      commandId: "accepted-group",
      entityIds: [id, soldier],
      target: { x: 12.5, y: 10.5 },
    },
  });
  world.step();
  expect(world.gatherTasks.has(id)).toBe(false);
  expect(world.workers.get(id)!.carried.amount).toBe(3);
  expect(world.soldiers.get(soldier)!.state).toBe("MOVING");
  expect(world.combats.get(soldier)!.targetEntityId).toBeNull();
});

it("copies combined economy/combat bootstrap snapshots defensively", () => {
  const runtime = createMatchRuntime({
    seed: 59,
    mapId: "foundation",
    participants: [{ playerId: 0 }],
  });
  const snapshot = runtime.readSnapshot();
  expect(snapshot.entities).toHaveLength(9);
  const workerView = snapshot.entities.find((e) => e.definitionId === "worker")!;
  const soldierView = snapshot.entities.find((e) => e.definitionId === "soldier")!;
  const resourceView = snapshot.entities.find((e) => e.resourceNode)!;
  workerView.worker!.carried.amount = 999;
  workerView.health!.current = 0;
  soldierView.health!.current = 0;
  resourceView.resourceNode!.remaining = 0;
  snapshot.playerEconomies[0]!.resources.WOOD = 999;
  const fresh = runtime.readSnapshot();
  expect(fresh.entities.find((e) => e.definitionId === "worker")).toMatchObject({
    teamId: PLAYER_TEAM,
    health: { current: 60, max: 60 },
    worker: { carried: { amount: 0 }, phase: "IDLE" },
  });
  expect(fresh.entities.find((e) => e.definitionId === "soldier")).toMatchObject({
    teamId: PLAYER_TEAM,
    health: { current: 100, max: 100 },
    soldierState: "IDLE",
  });
  expect(fresh.entities.find((e) => e.resourceNode)!.resourceNode!.remaining).toBe(100);
  expect(fresh.playerEconomies[0]!.resources.WOOD).toBe(0);
});
