import { readFileSync, statSync } from "node:fs";
import { FOUNDATION_MAP } from "@web-rts/game-data";
import {
  createWorld,
  PLAYER_TEAM,
  PVE_TEAM,
  spawnSoldier,
  type MatchEntitySnapshot,
} from "@web-rts/simulation";
import {
  definedScenario,
  matchFixture,
  parseScenarioDefinition,
  SCENARIO_LIMITS,
  type FixtureDriver,
  type ScenarioDefinition,
} from "@web-rts/testkit";

export const SCENARIO_IDS = ["move", "combat", "permanent-leave"] as const;
/** Fixed reviewed fixture registry: JSON never selects a module or filesystem path. */
function combatFixture(d: ScenarioDefinition): FixtureDriver {
  const world = createWorld({
    seed: d.seed,
    map: { ...FOUNDATION_MAP, staticTerrain: [], startingPlacements: [] },
  });
  const soldier = spawnSoldier(world, { x: -8.5, y: -8.5 }, PLAYER_TEAM);
  world.controllers.set(soldier, { controllerPlayerId: 0 });
  const enemy = world.createEntity({ kind: "UNIT", definitionId: "combat_fixture" });
  world.positions.set(enemy, { x: -4.5, y: -8.5 });
  world.teams.set(enemy, { teamId: PVE_TEAM });
  world.health.set(enemy, { current: 40, max: 40 });
  return {
    entities: () =>
      world.entityIds().map((entityId) => {
        const position = world.positions.get(entityId)!;
        const identity = world.identities.get(entityId)!;
        return {
          entityId,
          ...identity,
          ...position,
          ownerPlayerId: world.owners.get(entityId)?.ownerPlayerId ?? null,
          controllerPlayerId: world.controllers.get(entityId)?.controllerPlayerId ?? null,
          objectiveType: null,
          objectiveState: null,
          ...(world.soldiers.has(entityId)
            ? { soldierState: world.soldiers.get(entityId)!.state }
            : {}),
          ...(world.health.has(entityId) ? { health: { ...world.health.get(entityId)! } } : {}),
        } satisfies MatchEntitySnapshot;
      }),
    step: () => world.step(),
    drainEvents: () => world.drainEvents(),
    metrics: () => ({
      tick: world.tick,
      entityCount: world.entityIds().length,
      pendingCommandCount: world.pendingCommandCount(),
    }),
    move: (playerId, commandId, entityId, target) => {
      world.enqueueCommand({
        actor: { playerId },
        command: { type: "MOVE", commandId, entityIds: [entityId], target },
      });
      return { accepted: true };
    },
  };
}
export function scenarioFromDefinition(d: ScenarioDefinition) {
  return definedScenario(d, d.setup.fixture === "combat" ? combatFixture : matchFixture);
}
export function loadScenario(id: string): ScenarioDefinition {
  if (!SCENARIO_IDS.includes(id as (typeof SCENARIO_IDS)[number]))
    throw new Error(`Unknown scenario: ${id}. Available: ${SCENARIO_IDS.join(", ")}`);
  const file = new URL(`../scenarios/${id}.json`, import.meta.url);
  if (statSync(file).size > SCENARIO_LIMITS.bytes)
    throw new Error("Scenario input size cap exceeded");
  return parseScenarioDefinition(readFileSync(file, "utf8"));
}
export function gameplayScenario(id: string) {
  return scenarioFromDefinition(loadScenario(id));
}
