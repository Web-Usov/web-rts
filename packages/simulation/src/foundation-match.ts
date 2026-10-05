import { FOUNDATION_OBJECTIVE_POSITION, foundationUnitSpawnPosition } from "@web-rts/game-data";
import type { EntityId } from "./types.js";
import type { World } from "./world.js";

// Foundation match layout. Called only by MatchRuntime bootstrap, so Local and
// Remote cannot diverge. Map constants stay in game-data.

/**
 * One controllable primitive unit per player, indexed by spawn slot among the
 * players present at Start. Returns playerId → entityId.
 */
export function spawnFoundationUnits(
  world: World,
  playerIds: readonly number[],
): Map<number, EntityId> {
  const byPlayer = new Map<number, EntityId>();
  const ordered = [...new Set(playerIds)].sort((left, right) => left - right);
  ordered.forEach((playerId, spawnIndex) => {
    const entityId = world.createEntity();
    const spawn = foundationUnitSpawnPosition(spawnIndex);
    world.positions.set(entityId, { x: spawn.x, y: spawn.y });
    world.owners.set(entityId, { ownerPlayerId: playerId });
    world.controllers.set(entityId, { controllerPlayerId: playerId });
    byPlayer.set(playerId, entityId);
  });
  return byPlayer;
}

/** One generic Sacred Site at the foundation map center. It has no Controller. */
export function placeFoundationObjective(world: World): EntityId {
  const objectiveId = world.createEntity();
  world.positions.set(objectiveId, {
    x: FOUNDATION_OBJECTIVE_POSITION.x,
    y: FOUNDATION_OBJECTIVE_POSITION.y,
  });
  world.objectives.set(objectiveId, { type: "SACRED_SITE", state: "ACTIVE" });
  return objectiveId;
}
