import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP } from "@web-rts/game-data";
import { PLAYER_TEAM, PVE_TEAM, spawnSoldier } from "@web-rts/simulation";
import { runScenario } from "@web-rts/testkit";

describe("repeatable combat scenario", () => {
  it("repeats navigation, explicit MOVE, auto engagement and lethal outcomes with the same seed/commands/ticks", () => {
    const options: Parameters<typeof runScenario>[0] = {
      seed: 59,
      map: { ...FOUNDATION_MAP, staticTerrain: [], startingPlacements: [] },
      ticks: 130,
      setup: (world) => {
        const soldier = spawnSoldier(world, { x: -8.5, y: -8.5 }, PLAYER_TEAM);
        world.controllers.set(soldier, { controllerPlayerId: 0 });
        const enemy = world.createEntity({ kind: "UNIT", definitionId: "combat_fixture" });
        world.positions.set(enemy, { x: -4.5, y: -8.5 });
        world.teams.set(enemy, { teamId: PVE_TEAM });
        world.health.set(enemy, { current: 40, max: 40 });
      },
      commands: [
        {
          atTick: 1,
          command: {
            type: "MOVE",
            commandId: "override",
            entityIds: [1],
            target: { x: -6.5, y: -8.5 },
          },
        },
      ],
    };
    const first = runScenario(options);
    const second = runScenario(options);
    expect(first.hasEntity(2)).toBe(false);
    expect(first.soldiers.get(1)?.state).toBe("IDLE");
    expect(first.entityIds()).toEqual(second.entityIds());
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()]);
    expect([...first.health.entries()]).toEqual([...second.health.entries()]);
    expect([...first.combats.entries()]).toEqual([...second.combats.entries()]);
    expect([...first.soldiers.entries()]).toEqual([...second.soldiers.entries()]);
    expect(first.drainEvents()).toEqual(second.drainEvents());
  });
});
