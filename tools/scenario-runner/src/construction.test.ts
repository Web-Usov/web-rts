import { expect, it } from "vitest";
import { ENTITY_DEFINITIONS, FOUNDATION_MAP } from "@web-rts/game-data";
import { PLAYER_TEAM } from "@web-rts/simulation";
import { runScenario } from "@web-rts/testkit";

it("repeats BUILD, pause, resume and Tower completion for the same seed/map/commands/ticks", () => {
  const options: Parameters<typeof runScenario>[0] = {
    seed: 60,
    map: FOUNDATION_MAP,
    ticks: 180,
    setup(world) {
      const id = world.createEntity({ kind: "UNIT", definitionId: "worker" });
      world.positions.set(id, { x: 0.5, y: 0.5 });
      world.owners.set(id, { ownerPlayerId: 0 });
      world.controllers.set(id, { controllerPlayerId: 0 });
      world.teams.set(id, { teamId: PLAYER_TEAM });
      world.health.set(id, { current: 60, max: 60 });
      world.workers.set(id, {
        ...ENTITY_DEFINITIONS.worker.worker,
        carried: { resourceType: "WOOD", amount: 3 },
      });
      world.playerEconomies.set(0, { resources: { WOOD: 100 } });
    },
    commands: [
      {
        atTick: 0,
        command: {
          type: "BUILD",
          commandId: "new",
          builderEntityId: 1,
          target: { type: "NEW", buildingTypeId: "tower", anchorCell: { x: 20, y: 10 } },
        },
      },
      {
        atTick: 35,
        command: { type: "MOVE", commandId: "pause", entityIds: [1], target: { x: 0.5, y: 0.5 } },
      },
      {
        atTick: 50,
        command: {
          type: "BUILD",
          commandId: "resume",
          builderEntityId: 1,
          target: { type: "EXISTING", constructionEntityId: 2 },
        },
      },
    ],
  };
  const first = runScenario(options),
    second = runScenario(options);
  expect(first.constructions.get(2)).toMatchObject({ state: "COMPLETED", workedTicks: 60 });
  expect(first.playerEconomies.get(0)!.resources.WOOD).toBe(70);
  expect(first.workers.get(1)!.carried.amount).toBe(3);
  expect(first.buildTasks.has(1)).toBe(false);
  expect(first.topologyRevision).toBe(1);
  for (const key of ["positions", "constructions", "buildTasks", "workers", "health"] as const)
    expect([...first[key].entries()]).toEqual([...second[key].entries()]);
  expect(first.drainEvents()).toEqual(second.drainEvents());
});
