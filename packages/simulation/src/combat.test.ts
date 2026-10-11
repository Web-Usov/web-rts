import { describe, expect, it, vi } from "vitest";
import { FOUNDATION_MAP, type MapDefinition, type EntityKind } from "@web-rts/game-data";
import { createWorld, type World } from "./world.js";
import { spawnSoldier, placeStartingStructures } from "./foundation-match.js";
import { PLAYER_TEAM, PVE_TEAM, createTeamId, RelationshipPolicy } from "./teams.js";
import { isValidCombatTarget, inAttackRange } from "./systems/combat.js";
import { EntityPathQueryLane } from "./path-query-lane.js";
import { segmentIsTraversable } from "./navigation.js";
import { createMatchRuntime } from "./match-runtime.js";

const OPEN_MAP: MapDefinition = { ...FOUNDATION_MAP, staticTerrain: [], startingPlacements: [] };
function setup(budget = 8, map = OPEN_MAP) {
  const world = createWorld({ seed: 59, map, pathQueriesPerTick: { activeTaskBudget: budget } });
  const soldier = spawnSoldier(world, { x: -8.5, y: -8.5 }, PLAYER_TEAM);
  world.owners.set(soldier, { ownerPlayerId: 0 });
  world.controllers.set(soldier, { controllerPlayerId: 0 });
  return { world, soldier };
}
function target(world: World, x = -5.5, y = -8.5, kind: EntityKind = "UNIT") {
  const id = world.createEntity({ kind, definitionId: "combat_fixture" });
  world.positions.set(id, { x, y });
  world.teams.set(id, { teamId: PVE_TEAM });
  world.health.set(id, { current: 100, max: 100 });
  return id;
}
function move(world: World, id: number, x: number, y: number) {
  world.enqueueCommand({
    actor: { playerId: 0 },
    command: { type: "MOVE", commandId: `move-${world.tick}`, entityIds: [id], target: { x, y } },
  });
}

describe("Team and combat eligibility", () => {
  it("resolves different owners/same Team as friendly, no-owner PvE as hostile, unlisted factions as neutral", () => {
    const { world, soldier } = setup();
    const other = target(world);
    world.owners.set(other, { ownerPlayerId: 1 });
    world.teams.set(other, { teamId: PLAYER_TEAM });
    expect(
      world.relationships.resolve(world.teams.get(soldier)?.teamId, world.teams.get(other)?.teamId),
    ).toBe("FRIENDLY");
    expect(isValidCombatTarget(world, soldier, other)).toBe(false);
    world.owners.remove(other);
    world.teams.set(other, { teamId: PVE_TEAM });
    expect(isValidCombatTarget(world, soldier, other)).toBe(true);
    const neutral = createTeamId("neutral-faction");
    expect(world.relationships.resolve(PLAYER_TEAM, neutral)).toBe("NEUTRAL");
    expect(
      new RelationshipPolicy([{ teams: [PLAYER_TEAM, neutral], relationship: "HOSTILE" }]).resolve(
        neutral,
        PLAYER_TEAM,
      ),
    ).toBe("HOSTILE");
  });
  it("requires Team, Health, life and allowed kind; resources never acquire hostility from ownership", () => {
    const { world, soldier } = setup();
    const id = target(world);
    world.teams.remove(id);
    expect(isValidCombatTarget(world, soldier, id)).toBe(false);
    world.teams.set(id, { teamId: PVE_TEAM });
    world.health.remove(id);
    expect(isValidCombatTarget(world, soldier, id)).toBe(false);
    world.health.set(id, { current: 0, max: 100 });
    expect(isValidCombatTarget(world, soldier, id)).toBe(false);
    world.health.get(id)!.current = 100;
    expect(isValidCombatTarget(world, soldier, id)).toBe(true);
    const resource = target(world, -8, -8.5, "RESOURCE");
    expect(isValidCombatTarget(world, soldier, resource)).toBe(false);
    world.teams.remove(resource);
    world.owners.set(resource, { ownerPlayerId: 4 });
    world.stepN(3);
    expect(world.health.get(resource)?.current).toBe(100);
  });
  it("prevents friendly fire even with a manually assigned combat target", () => {
    const { world, soldier } = setup();
    const id = target(world, -8, -8.5);
    world.teams.set(id, { teamId: PLAYER_TEAM });
    world.soldiers.remove(soldier);
    world.combats.get(soldier)!.targetEntityId = id;
    world.stepN(20);
    expect(world.health.get(id)?.current).toBe(100);
    expect(world.combats.get(soldier)?.targetEntityId).toBeNull();
  });
  it("Controller transfer and permanent leave preserve Team and Owner", () => {
    const { world, soldier } = setup();
    world.controllers.set(soldier, { controllerPlayerId: 2 });
    world.releaseControlForPlayer(2);
    expect(world.teams.get(soldier)?.teamId).toBe(PLAYER_TEAM);
    expect(world.owners.get(soldier)?.ownerPlayerId).toBe(0);
  });
});

describe("tick damage and death", () => {
  it("strikes on ticks 0, 10, 20", () => {
    const { world, soldier } = setup();
    const id = target(world, -8, -8.5);
    world.step(); // tick 0
    expect(world.health.get(id)?.current).toBe(90);
    world.stepN(9); // ticks 1..9
    expect(world.health.get(id)?.current).toBe(90);
    world.step(); // tick 10
    expect(world.health.get(id)?.current).toBe(80);
    world.stepN(9);
    expect(world.health.get(id)?.current).toBe(80);
    world.step();
    expect(world.health.get(id)?.current).toBe(70);
    expect(world.combats.get(soldier)?.nextAttackTick).toBe(30);
  });
  it.each([5, 20])(
    "uses cooldown ticks at %i Hz and preserves cooldown on target replacement",
    (tickHz) => {
      const world = createWorld({ map: OPEN_MAP, tickHz });
      const soldier = spawnSoldier(world, { x: -8.5, y: -8.5 }, PLAYER_TEAM);
      const first = target(world, -8, -8.5);
      world.step();
      expect(world.health.get(first)?.current).toBe(90);
      world.destroyEntity(first);
      const second = target(world, -8, -8.5);
      world.stepN(9);
      expect(world.health.get(second)?.current).toBe(100);
      world.step();
      expect(world.health.get(second)?.current).toBe(90);
      expect(world.combats.get(soldier)?.nextAttackTick).toBe(20);
    },
  );

  it("cleans all active stores, footprint and references; objective outlives destroyed target", () => {
    const { world, soldier } = setup();
    const id = target(world, -8, -8.5, "OBJECTIVE");
    const objective = world.addObjective({
      type: "PROTECT",
      targetEntityId: id,
      teamId: PVE_TEAM,
      required: true,
      state: "ACTIVE",
    });
    world.health.get(id)!.current = 10;
    world.movements.set(id, { targetX: 9, targetY: 9, speed: 5 });
    world.owners.set(id, { ownerPlayerId: 3 });
    world.controllers.set(id, { controllerPlayerId: 3 });
    world.attacks.set(id, world.attacks.get(soldier)!);
    world.combats.set(id, { targetEntityId: soldier, nextAttackTick: 0 });
    world.placeSolidFootprint(id, {
      anchorCell: { x: 12, y: 11 },
      width: 1,
      height: 1,
      blocksMovement: true,
      blocksBuilding: true,
    });
    world.step();
    expect(world.hasEntity(id)).toBe(false);
    for (const store of [
      world.identities,
      world.positions,
      world.movements,
      world.owners,
      world.controllers,
      world.teams,
      world.health,
      world.attacks,
      world.combats,
      world.soldiers,
      world.soldierProfiles,
    ])
      expect(store.has(id)).toBe(false);
    expect(world.readNavigation(id)).toBeUndefined();
    expect(world.grid!.footprintOf(id)).toBeUndefined();
    expect(world.getObjective(objective)?.targetEntityId).toBe(id);
    expect(world.combats.get(soldier)?.targetEntityId).toBeNull();
    expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
  });
  it("resolves lethal attacks in ascending entityId order without retaliation", () => {
    const { world, soldier } = setup();
    const enemy = spawnSoldier(world, { x: -8, y: -8.5 }, PVE_TEAM);
    world.health.get(enemy)!.current = 10;
    world.health.get(soldier)!.current = 10;
    world.step();
    expect(world.hasEntity(enemy)).toBe(false);
    expect(world.health.get(soldier)?.current).toBe(10);
  });
});

describe("Soldier tasks and bounded navigation", () => {
  it("acquires nearest target, uses id tie-break and keeps it when a closer target appears", () => {
    const { world, soldier } = setup();
    const first = target(world, -6.5, -8.5);
    target(world, -10.5, -8.5);
    world.step();
    expect(world.soldiers.get(soldier)?.targetEntityId).toBe(first);
    target(world, -8, -8.5);
    world.step();
    expect(world.soldiers.get(soldier)?.targetEntityId).toBe(first);
  });
  it("prefers distance over entityId and reacquires after invalidation", () => {
    const { world, soldier } = setup();
    const farther = target(world, -4.5, -8.5);
    const nearer = target(world, -6.5, -8.5);
    world.step();
    expect(world.soldiers.get(soldier)?.targetEntityId).toBe(nearer);
    world.destroyEntity(nearer);
    world.step();
    expect(world.soldiers.get(soldier)?.targetEntityId).toBe(farther);
  });

  it("aggros and chases with navigation, attacks in range and does not A* every tick", () => {
    const { world, soldier } = setup();
    const id = target(world);
    world.step();
    expect(world.readNavigation(soldier)).toBeDefined();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    world.step();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(0);
    world.stepN(5);
    expect(inAttackRange(world, soldier, id)).toBe(true);
    expect(world.health.get(id)?.current).toBe(90);
  });
  it("keeps its acquisition anchor, limits chase and does not immediately re-anchor", () => {
    const { world, soldier } = setup();
    const id = target(world);
    world.stepN(6);
    expect(world.soldiers.get(soldier)?.anchor).toEqual({ x: -8.5, y: -8.5 });
    world.positions.set(id, { x: 0.5, y: -8.5 }); // 9 from fixed anchor, close to chased Soldier
    world.step();
    const stopped = { ...world.positions.get(soldier)! };
    expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
    world.stepN(5);
    expect(world.positions.get(soldier)).toEqual(stopped);
  });
  it("returns IDLE at current position after target loss, without returning to anchor", () => {
    const { world, soldier } = setup();
    const id = target(world);
    world.stepN(2);
    const current = { ...world.positions.get(soldier)! };
    world.teams.set(id, { teamId: PLAYER_TEAM });
    world.stepN(5);
    expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
    expect(world.positions.get(soldier)).toEqual(current);
  });
  it("explicit MOVE cancels engagement, ignores nearby enemies until arrival and resumes IDLE", () => {
    const { world, soldier } = setup();
    const id = target(world);
    world.step();
    move(world, soldier, -12.5, -8.5);
    world.step();
    expect(world.soldiers.get(soldier)?.state).toBe("MOVING");
    expect(world.combats.get(soldier)?.targetEntityId).toBeNull();
    world.stepN(8);
    expect(world.positions.get(soldier)).toEqual({ x: -12.5, y: -8.5 });
    expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
    expect(world.health.get(id)?.current).toBe(100);
  });
  it("rejecting a MOVE does not cancel combat; accepted stopped MOVE returns IDLE", () => {
    const { world, soldier } = setup();
    const id = target(world);
    world.step();
    move(world, soldier, 100, 100);
    world.step();
    expect(world.combats.get(soldier)?.targetEntityId).toBe(id);
    move(world, soldier, -14.5, -8.5);
    world.step();
    world.movements.remove(soldier);
    world.step();
    expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
  });
  it("releases unreachable targets and retries only after topology or target cell changes", () => {
    const map: MapDefinition = {
      ...OPEN_MAP,
      staticTerrain: [{ x: 13, y: 0, width: 1, height: 40, walkable: false, buildable: false }],
    };
    const { world, soldier } = setup(8, map);
    target(world, -5.5, -8.5);
    world.step();
    expect(world.soldiers.get(soldier)?.state).toBe("IDLE");
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    world.stepN(10);
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(0);
    expect(world.positions.get(soldier)).toEqual({ x: -8.5, y: -8.5 });
  });
  it("removes dead target memo entries from every Soldier while retaining living target entries", () => {
    const map: MapDefinition = {
      ...OPEN_MAP,
      staticTerrain: [{ x: 13, y: 0, width: 1, height: 40, walkable: false, buildable: false }],
    };
    const { world, soldier } = setup(8, map);
    const second = spawnSoldier(world, { x: -8.5, y: -7.5 }, PLAYER_TEAM);
    const livingTarget = target(world, -5.5, -8.5);
    world.step();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const doomed = target(world, -5.5, -8.5);
      world.step();
      for (const id of [soldier, second]) {
        expect(world.soldiers.get(id)!.unreachable.has(doomed)).toBe(true);
      }
      world.health.get(doomed)!.current = 0;
      world.step();
      expect(world.hasEntity(doomed)).toBe(false);
      for (const id of [soldier, second]) {
        const memo = world.soldiers.get(id)!.unreachable;
        expect([...memo.keys()]).toEqual([livingTarget]);
      }
    }
    world.destroyEntity(livingTarget);
    for (const id of [soldier, second]) {
      expect(world.soldiers.get(id)!.unreachable.size).toBe(0);
    }
  });
  it("melee approaches a 2×2 Sacred Site using perimeter goals and never crosses solid cells", () => {
    const { world, soldier } = setup();
    world.positions.set(soldier, { x: -3.5, y: -0.5 });
    const [site] = placeStartingStructures(world, FOUNDATION_MAP);
    world.teams.set(site!, { teamId: PVE_TEAM });
    let previous = { ...world.positions.get(soldier)! };
    for (let i = 0; i < 12; i++) {
      world.step();
      const current = world.positions.get(soldier)!;
      expect(segmentIsTraversable(world.grid!, previous, current)).toBe(true);
      previous = { ...current };
    }
    expect(inAttackRange(world, soldier, site!)).toBe(true);
    expect(world.health.get(site!)!.current).toBeLessThan(1000);
    expect(world.grid!.isWalkable(world.grid!.worldToCell(previous))).toBe(true);
  });
  it("shares one lane with MOVE replans, uses ascending ids and stops before deferred blockers", () => {
    const { world, soldier } = setup(1);
    const moving = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
    world.positions.set(moving, { x: -8.5, y: -11.5 });
    world.controllers.set(moving, { controllerPlayerId: 0 });
    move(world, moving, -2.5, -11.5);
    world.step();
    const blocker = world.createEntity({ kind: "BUILDING", definitionId: "blocker" });
    world.placeSolidFootprint(blocker, {
      anchorCell: { x: 13, y: 8 },
      width: 1,
      height: 1,
      blocksMovement: true,
      blocksBuilding: true,
    });
    target(world);
    const before = { ...world.positions.get(moving)! };
    const reserve = vi.spyOn(EntityPathQueryLane.prototype, "tryReserve");
    world.step();
    expect(reserve.mock.calls.map(([id]) => id)).toEqual([soldier, moving]);
    reserve.mockRestore();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    expect(world.positions.get(moving)).toEqual(before);
    world.step();
    expect(world.readPathQueryMetrics().activeTaskQueries).toBe(1);
    expect(segmentIsTraversable(world.grid!, before, world.positions.get(moving)!)).toBe(true);
  });
  it("bootstrap preserves Foundation proxies, adds one Soldier per participant, and retains allegiance after removal", () => {
    const runtime = createMatchRuntime({
      seed: 59,
      mapId: FOUNDATION_MAP.id,
      participants: [{ playerId: 7 }, { playerId: 2 }],
    });
    const snapshot = runtime.readSnapshot();
    for (const player of [2, 7]) {
      expect(
        snapshot.entities.filter((e) => e.ownerPlayerId === player).map((e) => e.definitionId),
      ).toEqual(["foundation_unit", "soldier"]);
      expect(
        snapshot.entities
          .filter((e) => e.ownerPlayerId === player)
          .every((e) => e.teamId === PLAYER_TEAM && e.controllerPlayerId === player),
      ).toBe(true);
    }
    const site = snapshot.entities.find((e) => e.definitionId === "sacred_site")!;
    expect(site).toMatchObject({
      ownerPlayerId: null,
      controllerPlayerId: null,
      teamId: PLAYER_TEAM,
      health: { current: 1000, max: 1000 },
      objectiveType: "PROTECT",
    });
    runtime.removePlayer(7);
    expect(
      runtime
        .readSnapshot()
        .entities.filter((e) => e.ownerPlayerId === 7)
        .every((e) => e.teamId === PLAYER_TEAM && e.controllerPlayerId === null),
    ).toBe(true);
    const soldier = snapshot.entities.find((e) => e.definitionId === "soldier")!;
    soldier.health!.current = 0;
    expect(
      runtime.readSnapshot().entities.find((e) => e.entityId === soldier.entityId)?.health?.current,
    ).toBe(100);
  });
});
