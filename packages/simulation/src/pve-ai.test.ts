import { describe, expect, it, vi } from "vitest";
import {
  ENTITY_DEFINITIONS,
  type MapDefinition,
  type EntityDefinitionId,
} from "@web-rts/game-data";
import { createWorld, type World } from "./world.js";
import { spawnEnemy, invalidateEnemy, isBreachable } from "./systems/pve-ai.js";
import { spawnSoldier } from "./foundation-match.js";
import { PLAYER_TEAM, PVE_TEAM, createTeamId } from "./teams.js";
import { EntityPathQueryLane } from "./path-query-lane.js";
import { segmentIsTraversable } from "./navigation.js";

const MAP: MapDefinition = {
  id: "g9",
  originX: 0,
  originY: 0,
  widthCells: 14,
  heightCells: 9,
  staticTerrain: [],
  playerSpawns: [],
  startingPlacements: [],
  resourcePlacements: [],
};
function solid(world: World, definitionId: EntityDefinitionId, x: number, y: number) {
  const def = ENTITY_DEFINITIONS[definitionId];
  const id = world.createEntity({ kind: def.kind, definitionId });
  world.positions.set(id, { x: x + def.footprint!.width / 2, y: y + def.footprint!.height / 2 });
  world.grid!.addFootprint(id, { ...def.footprint!, anchorCell: { x, y } });
  world.teams.set(id, { teamId: PLAYER_TEAM });
  world.health.set(id, { current: 40, max: 40 });
  return id;
}
function setup(budget = 8, map = MAP) {
  const world = createWorld({ seed: 62, map, pathQueriesPerTick: { aiBudget: budget } });
  const objective = solid(world, "sacred_site", 11, 3);
  world.addObjective({
    type: "PROTECT",
    state: "ACTIVE",
    targetEntityId: objective,
    teamId: PLAYER_TEAM,
    required: true,
  });
  const enemy = spawnEnemy(world, { x: 1.5, y: 3.5 });
  return { world, objective, enemy };
}
function barrier(world: World, definition: EntityDefinitionId = "wall") {
  return Array.from({ length: MAP.heightCells }, (_, y) => solid(world, definition, 7, y));
}
function until(world: World, predicate: () => boolean, limit = 300) {
  for (let i = 0; i < limit && !predicate(); i++) world.step();
  expect(predicate()).toBe(true);
}

describe("PvE objective and local combat", () => {
  it("spawns data-driven melee without Owner/Controller/Soldier and damages a generic PROTECT target", () => {
    const { world, enemy, objective } = setup();
    world.identities.set(objective, { kind: "OBJECTIVE", definitionId: "other_protected_target" });
    expect(world.owners.has(enemy)).toBe(false);
    expect(world.controllers.has(enemy)).toBe(false);
    expect(world.soldiers.has(enemy)).toBe(false);
    expect(world.attacks.get(enemy)).toEqual(ENTITY_DEFINITIONS.basic_melee_enemy.attack);
    until(world, () => (world.health.get(objective)?.current ?? 0) < 40);
    expect(world.positions.get(enemy)!.x).toBeGreaterThan(10);
  });
  it("chooses the lowest eligible objectiveId, ignoring neutral and dead objectives", () => {
    const { world, enemy, objective } = setup();
    const second = solid(world, "tower", 4, 7);
    world.addObjective({
      type: "PROTECT",
      state: "ACTIVE",
      targetEntityId: second,
      teamId: PLAYER_TEAM,
      required: false,
    });
    world.step();
    expect(world.enemies.get(enemy)!.objectiveId).toBe(1);
    world.teams.set(objective, { teamId: createTeamId("neutral") });
    world.step();
    expect(world.enemies.get(enemy)!.objectiveId).toBe(2);
    world.destroyEntity(second);
    world.stepN(20);
    expect(world.enemies.get(enemy)!.phase).toBe("STALLED");
    expect(world.combats.get(enemy)!.targetEntityId).toBeNull();
  });
  it("engages a nearby Soldier then resumes objective after death", () => {
    const { world, enemy, objective } = setup();
    const soldier = spawnSoldier(world, { x: 3.5, y: 3.5 }, PLAYER_TEAM);
    world.soldiers.remove(soldier); // Stationary defender isolates enemy decisions.
    world.attacks.remove(soldier);
    world.health.get(soldier)!.current = 20;
    world.step();
    expect(world.enemies.get(enemy)!.localTargetId).toBe(soldier);
    until(world, () => !world.hasEntity(soldier));
    expect(world.enemies.get(enemy)!.localTargetId).toBeNull();
    until(world, () => (world.health.get(objective)?.current ?? 0) < 40);
  });
  it("bounds chase by a fixed anchor and does not immediately reacquire", () => {
    const { world, enemy } = setup();
    const defender = spawnSoldier(world, { x: 3.5, y: 3.5 }, PLAYER_TEAM);
    world.soldiers.remove(defender);
    world.attacks.remove(defender);
    world.step();
    expect(world.enemies.get(enemy)!.anchor).toEqual({ x: 1.5, y: 3.5 });
    world.positions.set(defender, { x: 6.6, y: 3.5 });
    world.step();
    expect(world.enemies.get(enemy)!.localTargetId).toBeNull();
    expect(world.enemies.get(enemy)!.excludedUntilExit.has(defender)).toBe(true);
  });
  it("does not divert to remote Worker, Town Hall, Tower or nearby buildings", () => {
    const { world, enemy } = setup();
    const tower = solid(world, "tower", 2, 4);
    const hall = solid(world, "town_hall", 1, 7);
    const worker = world.createEntity({ kind: "UNIT", definitionId: "worker" });
    world.positions.set(worker, { x: 12.5, y: 8.5 });
    world.teams.set(worker, { teamId: PLAYER_TEAM });
    world.health.set(worker, { current: 60, max: 60 });
    world.stepN(20);
    expect(world.enemies.get(enemy)!.localTargetId).toBeNull();
    for (const id of [tower, hall]) expect(world.health.get(id)!.current).toBe(40);
    expect(world.health.get(worker)!.current).toBe(60);
  });
});

describe("deterministic breach and lifecycle", () => {
  it("splits normal/breach/approach across ticks, keeps first Wall sticky, destroys it through combat and replans normally", () => {
    const { world, enemy, objective } = setup();
    const walls = barrier(world);
    world.step();
    expect(world.enemies.get(enemy)!.phase).toBe("BREACH_SEARCH");
    expect(world.readPathQueryMetrics().aiQueries).toBe(1);
    world.step();
    const blocker = world.enemies.get(enemy)!.blockerId;
    expect(blocker).toBe(walls[3]);
    expect(world.movements.has(enemy)).toBe(false);
    world.step();
    expect(world.movements.has(enemy)).toBe(true);
    const unrelated = solid(world, "wall", 0, 8);
    world.stepN(8);
    expect(world.enemies.get(enemy)!.blockerId).toBe(blocker);
    world.destroyEntity(unrelated);
    until(world, () => !world.hasEntity(blocker!));
    expect(world.enemies.get(enemy)!.blockerId).toBeNull();
    until(world, () => (world.health.get(objective)?.current ?? 0) < 40);
    expect(walls.filter((id) => world.hasEntity(id))).toHaveLength(8);
  });
  it("preserves sticky blocker across temporary local engagement and handles another attacker removing it", () => {
    const { world, enemy } = setup();
    barrier(world);
    world.stepN(3);
    const blocker = world.enemies.get(enemy)!.blockerId!;
    const position = world.positions.get(enemy)!;
    const defender = spawnSoldier(world, { x: position.x + 1, y: position.y }, PLAYER_TEAM);
    world.soldiers.remove(defender);
    world.attacks.remove(defender);
    world.step();
    expect(world.enemies.get(enemy)!.localTargetId).toBe(defender);
    expect(world.enemies.get(enemy)!.blockerId).toBe(blocker);
    world.destroyEntity(defender);
    world.step();
    expect(world.enemies.get(enemy)!.blockerId).toBe(blocker);
    const ally = spawnEnemy(world, { x: 6.5, y: 3.5 });
    world.enemies.remove(ally); // Shared combat strikes the selected wall.
    world.combats.get(ally)!.targetEntityId = blocker;
    world.health.get(blocker)!.current = 10;
    world.step();
    expect(world.hasEntity(blocker)).toBe(false);
    expect(world.enemies.get(enemy)!.blockerId).toBeNull();
    expect(world.combats.get(enemy)!.targetEntityId).toBeNull();
  });
  it("breaks equal-cost ties stably and replays identically", () => {
    function replay() {
      const { world, enemy } = setup(1);
      barrier(world);
      solid(world, "wall", 6, 3); // forces equal upper/lower route choices
      const trace = [];
      for (let i = 0; i < 180; i++) {
        world.step();
        trace.push({
          position: { ...world.positions.get(enemy)! },
          blocker: world.enemies.get(enemy)!.blockerId,
          phase: world.enemies.get(enemy)!.phase,
          ids: world.entityIds(),
          metrics: world.readPathQueryMetrics(),
        });
      }
      expect(trace[1]!.blocker).not.toBeNull();
      expect(world.grid!.footprintOf(trace[1]!.blocker!)?.anchorCell.y ?? 2).toBe(2);
      return trace;
    }
    expect(replay()).toEqual(replay());
  });
  it("cleans attacker state, navigation and combat on death", () => {
    const { world, enemy } = setup();
    world.step();
    world.health.get(enemy)!.current = 0;
    world.step();
    expect(world.enemies.has(enemy)).toBe(false);
    expect(world.combats.has(enemy)).toBe(false);
    expect(world.readNavigation(enemy)).toBeUndefined();
    expect(world.movements.has(enemy)).toBe(false);
  });
  it("handles every objective approach cell being occupied by breachable Walls", () => {
    const { world, enemy, objective } = setup();
    const ring = [];
    for (let y = 2; y <= 5; y++)
      for (let x = 10; x <= 13; x++) {
        if (x >= 11 && x <= 12 && y >= 3 && y <= 4) continue;
        ring.push(solid(world, "wall", x, y));
      }
    world.stepN(2);
    expect(ring).toContain(world.enemies.get(enemy)!.blockerId);
    until(world, () => (world.health.get(objective)?.current ?? 0) < 40);
  });
});

describe("stall, capabilities and AI budget", () => {
  it.each(["friendly", "neutral", "resource", "capability", "health"])(
    "never breaches %s blockers; STALLED waits for topology",
    (mode) => {
      const { world, enemy } = setup();
      const walls = barrier(world, mode === "resource" ? "wood_node" : "wall");
      for (const id of walls) {
        if (mode === "friendly") world.teams.set(id, { teamId: PVE_TEAM });
        if (mode === "neutral") world.teams.remove(id);
        if (mode === "capability")
          world.identities.set(id, { kind: "BUILDING", definitionId: "no_breach" });
        if (mode === "health") world.health.remove(id);
        expect(isBreachable(world, enemy, id)).toBe(false);
      }
      world.stepN(2);
      expect(world.enemies.get(enemy)!.phase).toBe("STALLED");
      world.stepN(40);
      expect(world.readPathQueryMetrics().aiQueries).toBe(0);
      expect(world.combats.get(enemy)!.targetEntityId).toBeNull();
      world.destroyEntity(walls[3]!);
      world.step();
      expect(world.enemies.get(enemy)!.phase).toBe("ADVANCING");
    },
  );
  it("static terrain never becomes an attack target and explicit invalidation retries once", () => {
    const { world, enemy } = setup(8, {
      ...MAP,
      staticTerrain: [{ x: 7, y: 0, width: 1, height: 9, walkable: false, buildable: false }],
    });
    world.stepN(40);
    expect(world.enemies.get(enemy)!.phase).toBe("STALLED");
    expect(world.readPathQueryMetrics().aiQueries).toBe(0);
    invalidateEnemy(world, enemy);
    world.stepN(2);
    expect(world.enemies.get(enemy)!.phase).toBe("STALLED");
  });
  it("aiBudget=1 independently serves multiple enemies in ascending order, one query/entity/tick", () => {
    const { world, enemy } = setup(1);
    barrier(world);
    const others = [spawnEnemy(world, { x: 1.5, y: 5.5 }), spawnEnemy(world, { x: 1.5, y: 7.5 })];
    const reserve = vi.spyOn(EntityPathQueryLane.prototype, "tryReserve");
    for (let tick = 0; tick < 12; tick++) {
      reserve.mockClear();
      world.step();
      expect(world.readPathQueryMetrics().aiQueries).toBeLessThanOrEqual(1);
      expect(world.readPathQueryMetrics().activeTaskQueries).toBe(0);
      const ids = reserve.mock.calls.map(([id]) => id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      // Movement may attempt a deferred reservation twice, never executes two queries.
    }
    for (const id of [enemy, ...others]) expect(world.enemies.get(id)!.blockerId).not.toBeNull();
    reserve.mockRestore();
  });
  it("keeps AI progress independent from saturated command and active-task lanes", () => {
    const { world, enemy } = setup(1);
    const unit = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
    world.positions.set(unit, { x: 1.5, y: 8.5 });
    world.controllers.set(unit, { controllerPlayerId: 0 });
    for (let tick = 0; tick < 20; tick++) {
      for (let i = 0; i < 16; i++)
        world.enqueueCommand({
          actor: { playerId: 0 },
          command: {
            type: "MOVE",
            commandId: `${tick}-${i}`,
            entityIds: [unit],
            target: { x: 4.5, y: 8.5 },
          },
        });
      world.step();
    }
    expect(world.positions.get(enemy)!.x).toBeGreaterThan(6);
  });
  it("stops before invalidated topology with a spent AI budget and retries through breach", () => {
    const { world, enemy } = setup(1);
    world.step();
    barrier(world);
    const before = { ...world.positions.get(enemy)! };
    world.step();
    const after = world.positions.get(enemy)!;
    expect(segmentIsTraversable(world.grid!, before, after)).toBe(true);
    expect(after.x).toBeLessThan(7);
    expect(world.readPathQueryMetrics().aiQueries).toBe(1);
    until(world, () => world.enemies.get(enemy)!.blockerId !== null);
  });
});
