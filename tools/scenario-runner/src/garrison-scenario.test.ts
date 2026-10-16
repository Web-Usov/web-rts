import { expect, it } from "vitest";
import { ENTITY_DEFINITIONS, FOUNDATION_MAP } from "@web-rts/game-data";
import { PLAYER_TEAM, spawnSoldier } from "@web-rts/simulation";
import { runScenario } from "@web-rts/testkit";

it("repeats physical GARRISON, blocked UNGARRISON and forced ejection through the scenario runner", () => {
  const options: Parameters<typeof runScenario>[0] = {
    seed: 61,
    map: { ...FOUNDATION_MAP, staticTerrain: [], startingPlacements: [], resourcePlacements: [] },
    ticks: 80,
    setup(world) {
      const definition = ENTITY_DEFINITIONS.tower;
      const host = world.createEntity({ kind: "BUILDING", definitionId: "tower" });
      const footprint = { ...definition.footprint, anchorCell: { x: 10, y: 10 } };
      world.placeSolidFootprint(host, footprint);
      world.positions.set(host, world.grid!.footprintWorldCenter(footprint));
      world.teams.set(host, { teamId: PLAYER_TEAM });
      world.owners.set(host, { ownerPlayerId: 0 });
      world.health.set(host, { current: 300, max: 300 });
      world.constructions.set(host, { state: "COMPLETED", workedTicks: 60, durationTicks: 60 });
      const soldier = spawnSoldier(world, { x: -15.5, y: -9.5 }, PLAYER_TEAM);
      world.owners.set(soldier, { ownerPlayerId: 0 });
      world.controllers.set(soldier, { controllerPlayerId: 0 });
      world.health.get(soldier)!.current = 29;
    },
    commands: [
      {
        atTick: 0,
        command: { type: "GARRISON", commandId: "enter", unitEntityId: 2, containerEntityId: 1 },
      },
      { atTick: 25, command: { type: "UNGARRISON", commandId: "exit", unitEntityId: 2 } },
      {
        atTick: 26,
        command: { type: "GARRISON", commandId: "reenter", unitEntityId: 2, containerEntityId: 1 },
      },
      {
        atTick: 40,
        command: {
          type: "MOVE",
          commandId: "contained-move",
          entityIds: [2],
          target: { x: -15, y: -15 },
        },
      },
    ],
  };
  const run = () => {
    const world = runScenario(options);
    expect(world.containedIn.get(2)).toEqual({ containerEntityId: 1, slotIndex: 0 });
    for (let y = 9; y <= 11; y++)
      for (let x = 9; x <= 11; x++) {
        if (x === 10 && y === 10) continue;
        const wall = world.createEntity({ kind: "BUILDING", definitionId: "wall" });
        world.placeSolidFootprint(wall, {
          ...ENTITY_DEFINITIONS.wall.footprint,
          anchorCell: { x, y },
        });
      }
    world.enqueueCommand({
      actor: { playerId: 0 },
      command: { type: "UNGARRISON", commandId: "blocked", unitEntityId: 2 },
    });
    world.step();
    expect(world.containedIn.has(2)).toBe(true);
    world.destroyEntity(1);
    expect(world.positions.get(2)).toEqual({ x: -9.5, y: -9.5 });
    expect(world.health.get(2)?.current).toBe(29);
    expect([...world.containedIn.entries()]).toEqual([]);
    const events = world.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ commandId: "blocked", reason: "no_exit" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ commandId: "contained-move", reason: "entity_not_spatial" }),
    );
    return {
      entities: world.entityIds(),
      positions: [...world.positions.entries()],
      health: [...world.health.entries()],
      combat: [...world.combats.entries()],
      soldiers: [...world.soldiers.entries()],
      events,
    };
  };
  expect(run()).toEqual(run());
});
