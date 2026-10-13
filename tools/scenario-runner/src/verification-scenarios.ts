import { FOUNDATION_MAP } from "@web-rts/game-data";
import { createMatchRuntime, PLAYER_TEAM, PVE_TEAM, spawnSoldier } from "@web-rts/simulation";
import { runScenario, type EvidenceValue, type GameplayScenario } from "@web-rts/testkit";

/** Convert production snapshots to independent JSON data, without gameplay projection rules. */
function json(value: unknown): EvidenceValue {
  return JSON.parse(JSON.stringify(value)) as EvidenceValue;
}

export function gameplayScenario(id: string): GameplayScenario {
  if (id === "move") {
    const setup = { seed: 98, mapId: "foundation", participants: [{ playerId: 0 }] };
    const commands = [
      {
        atTick: 0,
        actor: { playerId: 0 },
        command: {
          type: "MOVE" as const,
          commandId: "verify-move",
          entityIds: [1],
          target: { x: 4, y: -3 },
        },
      },
    ];
    return {
      scenarioId: id,
      seed: setup.seed,
      ticks: 120,
      inputs: json({ setup, commands }),
      execute: () => {
        const runtime = createMatchRuntime(setup);
        const initial = runtime.readSnapshot();
        const admission = runtime.submitCommand(commands[0]!.actor, commands[0]!.command);
        const events = [];
        for (let tick = 0; tick < 120; tick += 1) {
          runtime.step();
          events.push(...runtime.drainEvents());
        }
        const snapshot = runtime.readSnapshot();
        const unit = snapshot.entities.find((entity) => entity.entityId === 1);
        return {
          checks: [
            {
              id: "command-admitted",
              tick: 0,
              expected: { accepted: true },
              actual: json(admission),
            },
            {
              id: "arrived-at-target",
              tick: 120,
              expected: { x: 4, y: -3 },
              actual: unit ? { x: unit.x, y: unit.y } : null,
            },
            { id: "no-rejections", tick: 120, expected: [], actual: json(events) },
            { id: "ticks-executed", tick: 120, expected: 120, actual: snapshot.tick },
          ],
          observations: json({ initial, snapshot, events, metrics: runtime.readMetrics() }),
        };
      },
    };
  }
  if (id === "combat") {
    const commands = [
      {
        atTick: 1,
        command: {
          type: "MOVE" as const,
          commandId: "override",
          entityIds: [1],
          target: { x: -6.5, y: -8.5 },
        },
      },
    ];
    const map = { ...FOUNDATION_MAP, staticTerrain: [], startingPlacements: [] };
    return {
      scenarioId: id,
      seed: 59,
      ticks: 130,
      inputs: json({
        map,
        fixture: {
          soldier: { position: { x: -8.5, y: -8.5 }, team: PLAYER_TEAM, controller: 0 },
          enemy: { position: { x: -4.5, y: -8.5 }, team: PVE_TEAM, health: 40 },
        },
        commands,
      }),
      execute: () => {
        const world = runScenario({
          seed: 59,
          map,
          ticks: 130,
          commands,
          setup: (world) => {
            const soldier = spawnSoldier(world, { x: -8.5, y: -8.5 }, PLAYER_TEAM);
            world.controllers.set(soldier, { controllerPlayerId: 0 });
            const enemy = world.createEntity({ kind: "UNIT", definitionId: "combat_fixture" });
            world.positions.set(enemy, { x: -4.5, y: -8.5 });
            world.teams.set(enemy, { teamId: PVE_TEAM });
            world.health.set(enemy, { current: 40, max: 40 });
          },
        });
        const events = world.drainEvents();
        return {
          checks: [
            { id: "enemy-killed", tick: 130, expected: false, actual: world.hasEntity(2) },
            { id: "soldier-survived", tick: 130, expected: true, actual: world.hasEntity(1) },
            {
              id: "soldier-idle-after-combat",
              tick: 130,
              expected: "IDLE",
              actual: world.soldiers.get(1)?.state ?? null,
            },
            {
              id: "no-command-rejections",
              tick: 130,
              expected: [],
              actual: json(events.filter((event) => event.type === "COMMAND_REJECTED")),
            },
          ],
          observations: json({
            entityIds: world.entityIds(),
            positions: [...world.positions.entries()],
            health: [...world.health.entries()],
            soldiers: [...world.soldiers.entries()],
            events,
          }),
        };
      },
    };
  }
  throw new Error(`Unknown scenario: ${id}. Available: move, combat`);
}
