import {
  FOUNDATION_OBJECTIVE_POSITION,
  foundationUnitSpawnPosition,
  isWithinFoundationBounds,
  type GroundPoint,
} from "@web-rts/game-data";
import type { EntityId } from "./types.js";
import { canIssueMove, type World } from "./world.js";

/**
 * Shared foundation match layout for the multiplayer host and the local worker.
 * Map constants stay in game-data; applying them to a World lives with simulation.
 */

export type FoundationMoveRefusal = "out_of_bounds" | "not_your_unit";

export type FoundationMoveDecision = { ok: true } | { ok: false; reason: FoundationMoveRefusal };

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

/**
 * Foundation MOVE gate: map bounds, then Controller permission.
 * Does not enqueue and does not read Owner.
 */
export function assessFoundationMove(
  world: World,
  playerId: number,
  entityIds: readonly number[],
  target: GroundPoint,
): FoundationMoveDecision {
  if (!isWithinFoundationBounds(target)) {
    return { ok: false, reason: "out_of_bounds" };
  }
  if (!canIssueMove(world, playerId, entityIds)) {
    return { ok: false, reason: "not_your_unit" };
  }
  return { ok: true };
}
