import type { EntityId, World } from "@web-rts/simulation";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type EntityView,
  type GameStateView,
  type MatchPhase,
  type PlayerSlotView,
} from "@web-rts/protocol";

/**
 * Temporary F5 binding: server-derived playerId → primitive unit entityId.
 * Not the F6 Owner/Controller permission model — replaced by controller checks later.
 */
export type PrimitiveUnitBinding = ReadonlyMap<number, EntityId>;

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
  /**
   * F5 binding used only to annotate EntityView owner/controller fields with the
   * bound player slot. Does not implement ownership transfer.
   */
  bindings: PrimitiveUnitBinding;
};

/**
 * Projects simulation World → protocol GameStateView.
 * Lives outside `@web-rts/simulation` (ADR-007). Does not import Colyseus/Babylon.
 *
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

      const boundPlayerId = findBoundPlayerId(input.bindings, entityId);
      entities.push({
        entityId,
        kind: "unit",
        x: position.x,
        y: position.y,
        // Minimal F5 annotation of the temporary player↔unit binding — not F6 semantics.
        ownerPlayerId: boundPlayerId,
        controllerPlayerId: boundPlayerId,
      });
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

function findBoundPlayerId(bindings: PrimitiveUnitBinding, entityId: EntityId): number | null {
  for (const [playerId, boundEntityId] of bindings) {
    if (boundEntityId === entityId) {
      return playerId;
    }
  }
  return null;
}
