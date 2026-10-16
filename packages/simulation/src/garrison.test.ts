import { describe, expect, it, vi } from "vitest";
import {
  ENTITY_DEFINITIONS,
  FOUNDATION_MAP,
  TOWER_ATTACK_PROFILES,
  type MapDefinition,
} from "@web-rts/game-data";
import { createWorld, World } from "./world.js";
import { spawnSoldier } from "./foundation-match.js";
import { PLAYER_TEAM, PVE_TEAM } from "./teams.js";
import type { SimulationCommand } from "./commands.js";
import { effectiveAttackProfile, inAttackRange, isValidCombatTarget } from "./systems/combat.js";
import { EntityPathQueryLane } from "./path-query-lane.js";
import { readWorldEntities } from "./snapshot.js";
import { createMatchRuntime } from "./match-runtime.js";
import { segmentIsTraversable } from "./navigation.js";

const map: MapDefinition = {
  ...FOUNDATION_MAP,
  originX: 0,
  originY: 0,
  widthCells: 20,
  heightCells: 15,
  staticTerrain: [],
  startingPlacements: [],
  resourcePlacements: [],
};
function host(world: World, x = 8, y = 5) {
  const id = world.createEntity({ kind: "BUILDING", definitionId: "tower" });
  const def = ENTITY_DEFINITIONS.tower;
  world.positions.set(id, world.grid!.cellToWorldCenter({ x, y }));
  world.owners.set(id, { ownerPlayerId: 0 });
  world.teams.set(id, { teamId: PLAYER_TEAM });
  world.health.set(id, { current: def.maxHealth, max: def.maxHealth });
  world.constructions.set(id, { state: "COMPLETED", workedTicks: 60, durationTicks: 60 });
  expect(world.placeSolidFootprint(id, { ...def.footprint, anchorCell: { x, y } }).ok).toBe(true);
  return id;
}
function unit(world: World, x = 2.5, y = 5.5) {
  const id = spawnSoldier(world, { x, y }, PLAYER_TEAM);
  world.owners.set(id, { ownerPlayerId: 0 });
  world.controllers.set(id, { controllerPlayerId: 0 });
  return id;
}
function enemy(world: World, x = 12.5, y = 5.5) {
  const id = world.createEntity({ kind: "UNIT", definitionId: "target" });
  world.positions.set(id, { x, y });
  world.teams.set(id, { teamId: PVE_TEAM });
  world.health.set(id, { current: 1000, max: 1000 });
  return id;
}
function setup(budget = 8) {
  const world = createWorld({ map, seed: 61, pathQueriesPerTick: { activeTaskBudget: budget } });
  const tower = host(world);
  const soldier = unit(world);
  return { world, tower, soldier };
}
function command(world: World, command: SimulationCommand, playerId = 0) {
  world.enqueueCommand({ actor: { playerId }, command });
}
function garrison(
  world: World,
  unitEntityId: number,
  containerEntityId: number,
  commandId = "enter",
) {
  command(world, { type: "GARRISON", commandId, unitEntityId, containerEntityId });
}
function until(world: World, predicate: () => boolean) {
  for (let i = 0; i < 150 && !predicate(); i++) world.step();
  expect(predicate()).toBe(true);
}
function enter(world: World, soldier: number, tower: number) {
  garrison(world, soldier, tower);
  until(world, () => world.containedIn.has(soldier));
}
function move(world: World, ids: number[], target = { x: 1.5, y: 1.5 }) {
  command(world, { type: "MOVE", commandId: "move", entityIds: ids, target });
}
function block(world: World, x: number, y: number) {
  const id = world.createEntity({ kind: "BUILDING", definitionId: "wall" });
  expect(
    world.placeSolidFootprint(id, { ...ENTITY_DEFINITIONS.wall.footprint, anchorCell: { x, y } })
      .ok,
  ).toBe(true);
  return id;
}
function invariants(world: World) {
  const slots = new Set<string>();
  for (const [id, relation] of world.containedIn.entries()) {
    expect(world.hasEntity(id)).toBe(true);
    expect(world.positions.has(id)).toBe(false);
    expect(world.movements.has(id)).toBe(false);
    expect(world.readNavigation(id)).toBeUndefined();
    expect(world.combats.get(id)?.targetEntityId).toBeNull();
    expect(world.hasEntity(relation.containerEntityId)).toBe(true);
    expect(relation.slotIndex).toBeGreaterThanOrEqual(0);
    expect(relation.slotIndex).toBeLessThan(
      world.garrisonHosts.get(relation.containerEntityId)!.capacity,
    );
    const key = `${relation.containerEntityId}:${relation.slotIndex}`;
    expect(slots.has(key)).toBe(false);
    slots.add(key);
  }
}

describe("automatic ranged host combat", () => {
  it("selects nearest with id tie-break, keeps a valid target, fires immediately and respects cooldown", () => {
    const { world, tower, soldier } = setup();
    world.destroyEntity(soldier);
    const first = enemy(world, 12.5, 5.5);
    const tied = enemy(world, 4.5, 5.5);
    world.step();
    expect(world.combats.get(tower)?.targetEntityId).toBe(first);
    expect(world.health.get(first)?.current).toBe(988);
    const closer = enemy(world, 9.5, 5.5);
    world.stepN(19);
    expect(world.combats.get(tower)?.targetEntityId).toBe(first);
    expect(world.health.get(first)?.current).toBe(988);
    world.step();
    expect(world.health.get(first)?.current).toBe(976);
    world.positions.set(first, { x: 19.5, y: 14.5 });
    world.step();
    expect(world.combats.get(tower)?.targetEntityId).toBe(closer);
    expect(world.health.get(tied)?.current).toBe(1000);
    expect(world.health.get(closer)?.current).toBe(1000);
  });
  it("fires across friendly walls without weakening melee segment checks", () => {
    const { world, tower, soldier } = setup();
    world.destroyEntity(soldier);
    const target = enemy(world, 10.5, 5.5);
    block(world, 9, 5);
    world.step();
    expect(world.health.get(target)?.current).toBe(988);
    const melee = unit(world, 8.9, 4.5);
    world.attacks.set(melee, { ...ENTITY_DEFINITIONS.soldier.attack, range: 5 });
    const other = enemy(world, 10.5, 4.5);
    block(world, 9, 4);
    expect(inAttackRange(world, tower, target)).toBe(true);
    expect(inAttackRange(world, melee, other)).toBe(false);
  });
  it("under-construction host neither fires nor accepts occupants", () => {
    const { world, tower, soldier } = setup();
    world.constructions.get(tower)!.state = "UNDER_CONSTRUCTION";
    const target = enemy(world);
    garrison(world, soldier, tower);
    world.stepN(5);
    expect(world.health.get(target)?.current).toBe(1000);
    expect(world.containedIn.has(soldier)).toBe(false);
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "COMMAND_REJECTED", reason: "host_not_completed" }),
    );
  });
  it("derives shorter/faster infantry style, reselects target, and preserves already scheduled cooldown on entry/exit", () => {
    const { world, tower, soldier } = setup();
    world.positions.set(soldier, { x: 7.5, y: 5.5 });
    const far = enemy(world, 14.5, 5.5);
    world.step();
    expect(world.health.get(far)?.current).toBe(988);
    const next = world.combats.get(tower)!.nextAttackTick;
    const near = enemy(world, 12.5, 5.5);
    enter(world, soldier, tower);
    expect(effectiveAttackProfile(world, tower)).toEqual(TOWER_ATTACK_PROFILES.infantry);
    expect(TOWER_ATTACK_PROFILES.infantry.range).toBeLessThan(TOWER_ATTACK_PROFILES.empty.range);
    expect(TOWER_ATTACK_PROFILES.infantry.cooldownTicks).toBeLessThan(
      TOWER_ATTACK_PROFILES.empty.cooldownTicks,
    );
    world.step(); // host id precedes entrant: targeting re-evaluates on the next tick
    expect(world.combats.get(tower)?.targetEntityId).toBe(near);
    expect(world.combats.get(tower)?.nextAttackTick).toBe(next);
    until(world, () => world.tick === next + 1);
    expect(world.health.get(near)?.current).toBe(988);
    world.stepN(7);
    expect(world.health.get(near)?.current).toBe(988);
    world.step();
    expect(world.health.get(near)?.current).toBe(976);
    const scheduled = world.combats.get(tower)!.nextAttackTick;
    command(world, { type: "UNGARRISON", commandId: "exit", unitEntityId: soldier });
    world.step();
    expect(effectiveAttackProfile(world, tower)).toEqual(TOWER_ATTACK_PROFILES.empty);
    expect(world.combats.get(tower)?.nextAttackTick).toBe(scheduled);
  });
});

describe("authoritative containment tasks", () => {
  it("approaches through Movement without teleporting; preserves non-spatial state and fresh snapshot", () => {
    const { world, tower, soldier } = setup();
    world.health.get(soldier)!.current = 43;
    garrison(world, soldier, tower);
    world.step();
    expect(world.containedIn.has(soldier)).toBe(false);
    expect(world.positions.get(soldier)?.x).toBe(3);
    expect(world.readNavigation(soldier)).toBeDefined();
    until(world, () => world.containedIn.has(soldier));
    invariants(world);
    expect(world.health.get(soldier)?.current).toBe(43);
    const snapshot = readWorldEntities(world).find((e) => e.entityId === soldier)!;
    expect(snapshot).toMatchObject({
      location: { type: "CONTAINED", containerEntityId: tower, slotIndex: 0 },
      ownerPlayerId: 0,
      controllerPlayerId: 0,
      teamId: PLAYER_TEAM,
      health: { current: 43 },
    });
    expect(snapshot).not.toHaveProperty("x");
    if (snapshot.location.type === "CONTAINED") snapshot.location.containerEntityId = 999;
    expect(world.containedIn.get(soldier)?.containerEntityId).toBe(tower);
  });
  it.each(["owner", "controller", "tags", "host", "dead", "capacity"] as const)(
    "rejects initial %s validation",
    (kind) => {
      const { world, tower, soldier } = setup();
      const reasons = {
        owner: "invalid_owner",
        controller: "not_controller",
        tags: "ineligible_occupant",
        host: "invalid_garrison_host",
        dead: "entity_not_found",
        capacity: "no_garrison_slot",
      };
      if (kind === "owner") world.owners.get(tower)!.ownerPlayerId = 2;
      if (kind === "controller") world.controllers.get(soldier)!.controllerPlayerId = 2;
      if (kind === "tags") world.identities.set(soldier, { kind: "UNIT", definitionId: "worker" });
      if (kind === "host") world.garrisonHosts.remove(tower);
      if (kind === "dead") world.health.get(soldier)!.current = 0;
      if (kind === "capacity")
        world.garrisonHosts.set(tower, { ...world.garrisonHosts.get(tower)!, capacity: 0 });
      garrison(world, soldier, tower);
      world.step();
      expect(world.drainEvents()).toContainEqual(
        expect.objectContaining({ type: "COMMAND_REJECTED", reason: reasons[kind] }),
      );
      expect(world.garrisonTasks.has(soldier)).toBe(false);
    },
  );
  it.each(["owner", "controller", "tags", "host", "completion", "destruction"] as const)(
    "reports one late ACTION_FAILED for %s invalidation",
    (kind) => {
      const { world, tower, soldier } = setup();
      garrison(world, soldier, tower);
      world.step();
      world.drainEvents();
      const reasons = {
        owner: "invalid_owner",
        controller: "not_controller",
        tags: "ineligible_occupant",
        host: "invalid_garrison_host",
        completion: "host_not_completed",
        destruction: "target_removed",
      };
      if (kind === "owner") world.owners.get(tower)!.ownerPlayerId = 2;
      if (kind === "controller") world.controllers.remove(soldier);
      if (kind === "tags") world.identities.set(soldier, { kind: "UNIT", definitionId: "worker" });
      if (kind === "host") world.garrisonHosts.remove(tower);
      if (kind === "completion") world.constructions.get(tower)!.state = "UNDER_CONSTRUCTION";
      if (kind === "destruction") world.destroyEntity(tower);
      world.stepN(30);
      expect(world.drainEvents()).toEqual([
        expect.objectContaining({
          type: "ACTION_FAILED",
          action: "GARRISON",
          commandId: "enter",
          reason: reasons[kind],
        }),
      ]);
      expect(world.garrisonTasks.has(soldier)).toBe(false);
      expect(world.positions.has(soldier)).toBe(true);
      expect(world.containedIn.has(soldier)).toBe(false);
    },
  );
  it("orders same-tick arrivals by ascending unit id and rejects later contention without duplicate slots", () => {
    const { world, tower, soldier } = setup();
    world.positions.set(soldier, { x: 7.5, y: 5.5 });
    const other = unit(world, 7.5, 5.5);
    garrison(world, other, tower, "second");
    garrison(world, soldier, tower, "first");
    world.step();
    expect(world.containedIn.has(soldier)).toBe(true);
    expect(world.containedIn.has(other)).toBe(false);
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: "ACTION_FAILED",
        commandId: "second",
        reason: "no_garrison_slot",
      }),
    );
    garrison(world, other, tower, "full");
    world.step();
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: "COMMAND_REJECTED",
        commandId: "full",
        reason: "no_garrison_slot",
      }),
    );
    invariants(world);
  });
  it("generic host allocates lowest free slot, never a Tower/Soldier-specific branch", () => {
    const { world, tower, soldier } = setup();
    world.identities.set(tower, { kind: "BUILDING", definitionId: "custom_host" });
    world.garrisonHosts.set(tower, { ...world.garrisonHosts.get(tower)!, capacity: 3 });
    const ids = [soldier, unit(world), unit(world)];
    for (const id of ids) enter(world, id, tower);
    expect(world.occupantsOf(tower).map(([, r]) => r.slotIndex)).toEqual([0, 1, 2]);
    command(world, { type: "UNGARRISON", commandId: "exit", unitEntityId: ids[1]! });
    world.step();
    enter(world, ids[1]!, tower);
    expect(world.containedIn.get(ids[1]!)?.slotIndex).toBe(1);
    invariants(world);
  });
  it("accepted MOVE cancels pending entry; rejected MOVE/GARRISON preserves its task", () => {
    const { world, tower, soldier } = setup();
    garrison(world, soldier, tower);
    world.step();
    const task = world.garrisonTasks.get(soldier);
    move(world, [soldier], { x: 99, y: 99 });
    world.step();
    expect(world.garrisonTasks.get(soldier)).toBe(task);
    garrison(world, soldier, 999, "bad-replacement");
    world.step();
    expect(world.garrisonTasks.get(soldier)).toBe(task);
    move(world, [soldier]);
    world.step();
    expect(world.garrisonTasks.has(soldier)).toBe(false);
    world.stepN(30);
    expect(world.containedIn.has(soldier)).toBe(false);
  });
  it("rejects a whole mixed MOVE atomically, and contained GARRISON cannot create spatial state", () => {
    const { world, tower, soldier } = setup();
    enter(world, soldier, tower);
    const spatial = unit(world, 1.5, 1.5);
    move(world, [spatial, soldier]);
    world.step();
    expect(world.movements.has(spatial)).toBe(false);
    expect(world.positions.get(spatial)).toEqual({ x: 1.5, y: 1.5 });
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "COMMAND_REJECTED", reason: "entity_not_spatial" }),
    );
    garrison(world, soldier, tower);
    world.step();
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ reason: "entity_not_spatial" }),
    );
    invariants(world);
  });
  it("contained Soldier has no independent targetability, auto-aggro, attack or path queries", () => {
    const { world, tower, soldier } = setup();
    enter(world, soldier, tower);
    const target = enemy(world, 7.5, 5.5);
    expect(isValidCombatTarget(world, soldier, target)).toBe(false);
    world.attacks.set(target, ENTITY_DEFINITIONS.soldier.attack);
    expect(isValidCombatTarget(world, target, soldier)).toBe(false);
    world.stepN(21);
    expect(world.health.get(target)?.current).toBe(964); // only three Tower strikes
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(0);
    invariants(world);
  });
});

describe("exits and host destruction", () => {
  it("normal exit uses first row-major perimeter cell and validates controller/contained state", () => {
    const { world, tower, soldier } = setup();
    enter(world, soldier, tower);
    command(world, { type: "UNGARRISON", commandId: "forbidden", unitEntityId: soldier }, 2);
    world.step();
    expect(world.containedIn.has(soldier)).toBe(true);
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ reason: "not_controller" }),
    );
    command(world, { type: "UNGARRISON", commandId: "exit", unitEntityId: soldier });
    world.step();
    expect(world.positions.get(soldier)).toEqual({ x: 7.5, y: 4.5 });
    expect(world.containedIn.has(soldier)).toBe(false);
    command(world, { type: "UNGARRISON", commandId: "twice", unitEntityId: soldier });
    world.step();
    expect(world.drainEvents()).toContainEqual(
      expect.objectContaining({ reason: "not_contained" }),
    );
  });
  it.each(["direct", "health", "combat"] as const)(
    "blocked normal exit preserves relation, but %s destruction ejects alive at former anchor",
    (death) => {
      const { world, tower, soldier } = setup();
      enter(world, soldier, tower);
      world.health.get(soldier)!.current = 37;
      for (let y = 4; y <= 6; y++)
        for (let x = 7; x <= 9; x++) if (x !== 8 || y !== 5) block(world, x, y);
      command(world, { type: "UNGARRISON", commandId: "blocked-exit", unitEntityId: soldier });
      world.step();
      expect(world.containedIn.get(soldier)).toEqual({ containerEntityId: tower, slotIndex: 0 });
      expect(world.drainEvents()).toContainEqual(expect.objectContaining({ reason: "no_exit" }));
      if (death === "direct") world.destroyEntity(tower);
      if (death === "health") {
        world.health.get(tower)!.current = 0;
        world.step();
      }
      if (death === "combat") {
        const attacker = enemy(world, 12.5, 5.5);
        world.attacks.set(attacker, { ...TOWER_ATTACK_PROFILES.empty, damage: 500 });
        world.combats.set(attacker, { targetEntityId: tower, nextAttackTick: 0 });
        world.step();
      }
      expect(world.hasEntity(tower)).toBe(false);
      expect(world.positions.get(soldier)).toEqual({ x: 8.5, y: 5.5 });
      expect(world.health.get(soldier)?.current).toBe(37);
      expect(world.owners.get(soldier)?.ownerPlayerId).toBe(0);
      expect(world.controllers.get(soldier)?.controllerPlayerId).toBe(0);
      expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
      expect([...world.containedIn.entries()]).toEqual([]);
    },
  );
  it("forced fallback chooses nearest walkable cell with row-major tie-break after lost host footprint", () => {
    const { world, tower, soldier } = setup();
    enter(world, soldier, tower);
    world.removeSolidFootprint(tower);
    block(world, 8, 5);
    world.destroyEntity(tower);
    expect(world.positions.get(soldier)).toEqual({ x: 8.5, y: 4.5 });
    expect(world.containedIn.has(soldier)).toBe(false);
  });
  it("forced ejection with no walkable cell destroys occupants deterministically without throwing or dangling relations", () => {
    const { world, tower, soldier } = setup();
    enter(world, soldier, tower);
    world.removeSolidFootprint(tower);
    for (let y = 0; y < map.heightCells; y++)
      for (let x = 0; x < map.widthCells; x++) block(world, x, y);
    expect(() => world.destroyEntity(tower)).not.toThrow();
    expect(world.hasEntity(tower)).toBe(false);
    expect(world.hasEntity(soldier)).toBe(false);
    expect([...world.containedIn.entries()]).toEqual([]);
    invariants(world);
  });
  it("destroying an occupant frees its derived slot without damaging the host", () => {
    const { world, tower, soldier } = setup();
    enter(world, soldier, tower);
    world.destroyEntity(soldier);
    expect(world.occupantsOf(tower)).toEqual([]);
    expect(world.health.get(tower)?.current).toBe(300);
    expect(effectiveAttackProfile(world, tower)).toEqual(TOWER_ATTACK_PROFILES.empty);
    enter(world, unit(world), tower);
    invariants(world);
  });
});

it("rejects unreachable approach and shares ascending active-task budget with MOVE replans", () => {
  const { world, tower, soldier } = setup(1);
  const other = unit(world, 2.5, 9.5);
  garrison(world, soldier, tower);
  move(world, [other], { x: 10.5, y: 9.5 });
  world.step();
  block(world, 4, 5);
  block(world, 4, 9);
  const before = { ...world.positions.get(other)! };
  const reserve = vi.spyOn(EntityPathQueryLane.prototype, "tryReserve");
  world.step();
  expect(reserve.mock.calls.map(([id]) => id)).toEqual([soldier, other]);
  reserve.mockRestore();
  expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
  expect(world.positions.get(other)).toEqual(before);
  world.step();
  expect(segmentIsTraversable(world.grid!, before, world.positions.get(other)!)).toBe(true);
  for (let y = 0; y < map.heightCells; y++) if (y !== 5 && y !== 9) block(world, 4, y);
  garrison(world, other, tower, "unreachable");
  world.step();
  expect(world.drainEvents()).toContainEqual(
    expect.objectContaining({ commandId: "unreachable", reason: "no_path" }),
  );
});

it("drains transport-neutral runtime failures and retains contained living snapshots identically across host executions", () => {
  let current: World | undefined;
  const original = World.prototype.step;
  const spy = vi.spyOn(World.prototype, "step").mockImplementation(function (this: World) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
    original.call(this);
  });
  const run = () => {
    const runtime = createMatchRuntime({
      seed: 61,
      mapId: FOUNDATION_MAP.id,
      participants: [{ playerId: 0 }],
    });
    runtime.step();
    const world = current!;
    // Fixture on the existing production runtime; no alternative gameplay host.
    const tower = host(world, 8, 5);
    const soldier = unit(world, -12.5, -14.5);
    const snapshots = [],
      events = [];
    runtime.submitCommand(
      { playerId: 0 },
      {
        type: "GARRISON",
        commandId: "runtime-enter",
        unitEntityId: soldier,
        containerEntityId: tower,
      },
    );
    for (let i = 0; i < 5; i++) {
      runtime.step();
      snapshots.push(runtime.readSnapshot());
      events.push(runtime.drainEvents());
    }
    for (let i = 0; i < 80 && !world.containedIn.has(soldier); i++) {
      runtime.step();
      snapshots.push(runtime.readSnapshot());
      events.push(runtime.drainEvents());
    }
    expect(world.containedIn.has(soldier)).toBe(true);
    const contained = runtime.readSnapshot();
    runtime.submitCommand(
      { playerId: 0 },
      {
        type: "MOVE",
        commandId: "contained-move",
        entityIds: [soldier],
        target: { x: -15, y: -15 },
      },
    );
    runtime.step();
    events.push(runtime.drainEvents());
    expect(runtime.readMetrics().reservedCommandPathCost).toBe(1);
    expect(events.at(-1)).toEqual([
      expect.objectContaining({ reason: "entity_not_spatial", recipientPlayerId: 0 }),
    ]);
    expect(contained.entities.find((e) => e.entityId === soldier)?.location.type).toBe("CONTAINED");
    expect(runtime.drainEvents()).toEqual([]);
    return { snapshots, contained, events };
  };
  try {
    expect(run()).toEqual(run());
  } finally {
    spy.mockRestore();
  }
});
