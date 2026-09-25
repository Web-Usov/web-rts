import type { EntityId, World } from "@web-rts/simulation";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type EntityView,
  type GameStateView,
  type MatchPhase,
  type PlayerSlotView,
} from "@web-rts/protocol";

export type ReplicationPlayerSlot = {
  playerId: number;
  connected: boolean;
};

export type ReplicationAdapterInput = {
  world: World | null;
  roomId: string;
  phase: MatchPhase;
  /** Recipient session player id (per-client projection hook for ADR-007). */
  localPlayerId: number;
  players: readonly ReplicationPlayerSlot[];
};

/**
 * Projects simulation World → protocol GameStateView.
 * Lives outside `@web-rts/simulation` (ADR-007). Does not import Colyseus/Babylon.
 *
 * Owner, controller, and objective fields are read from component stores.
 * Foundation replicates the same entity set to every player; `localPlayerId` is the
 * only per-recipient field today, leaving room for future fog filtering.
 */
export function projectWorldToGameStateView(input: ReplicationAdapterInput): GameStateView {
  const entities: EntityView[] = [];

  if (input.world) {
    for (const entityId of input.world.entityIds()) {
      const position = input.world.positions.get(entityId);
      if (position === undefined) {
        continue;
      }
      entities.push(projectEntity(input.world, entityId, position.x, position.y));
    }
  }

  const players: PlayerSlotView[] = input.players.map((slot) => ({
    playerId: slot.playerId,
    connected: slot.connected,
  }));

  return {
    protocolVersion: PROTOCOL_VERSION,
    gameDataVersion: GAME_DATA_VERSION,
    roomId: input.roomId,
    tick: input.world?.tick ?? 0,
    phase: input.phase,
    localPlayerId: input.localPlayerId,
    players,
    entities,
  };
}

function projectEntity(world: World, entityId: EntityId, x: number, y: number): EntityView {
  const objective = world.objectives.get(entityId);
  const owner = world.owners.get(entityId);
  const controller = world.controllers.get(entityId);

  return {
    entityId,
    kind: objective === undefined ? "unit" : "objective",
    x,
    y,
    ownerPlayerId: owner?.ownerPlayerId ?? null,
    controllerPlayerId: controller?.controllerPlayerId ?? null,
    objectiveType: objective?.type ?? null,
    objectiveState: objective?.state ?? null,
  };
}
