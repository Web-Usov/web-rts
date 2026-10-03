import { readWorldSnapshot, type World, type WorldEntitySnapshot } from "@web-rts/simulation";
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
 * Projects a transport-neutral world snapshot into GameStateView.
 * The World walk stays in simulation. This adapter only adds the protocol envelope
 * and does not import Colyseus or Babylon (ADR-007).
 */
export function projectWorldToGameStateView(input: ReplicationAdapterInput): GameStateView {
  const snapshot = input.world ? readWorldSnapshot(input.world) : null;
  const players: PlayerSlotView[] = input.players.map((slot) => ({
    playerId: slot.playerId,
    connected: slot.connected,
  }));

  return {
    protocolVersion: PROTOCOL_VERSION,
    gameDataVersion: GAME_DATA_VERSION,
    roomId: input.roomId,
    tick: snapshot?.tick ?? 0,
    phase: input.phase,
    localPlayerId: input.localPlayerId,
    players,
    entities: (snapshot?.entities ?? []).map(toEntityView),
  };
}

function toEntityView(entity: WorldEntitySnapshot): EntityView {
  return {
    entityId: entity.entityId,
    kind: entity.kind,
    x: entity.x,
    y: entity.y,
    ownerPlayerId: entity.ownerPlayerId,
    controllerPlayerId: entity.controllerPlayerId,
    objectiveType: entity.objectiveType,
    objectiveState: entity.objectiveState,
  };
}
