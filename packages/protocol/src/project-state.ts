import type { EntityView, GameStateView, MatchPhase, PlayerSlotView } from "./state.js";
import { GAME_DATA_VERSION, PROTOCOL_VERSION } from "./versions.js";

/**
 * Structural view of the fields Replication needs from a simulation world.
 * Kept free of the simulation package so both the server and the local worker
 * can project the same GameStateView (ADR-007).
 */
export type ReplicationWorldSource = {
  readonly tick: number;
  entityIds(): readonly number[];
  readonly positions: {
    get(entityId: number): { readonly x: number; readonly y: number } | undefined;
  };
  readonly objectives: {
    get(entityId: number): { readonly type: "SACRED_SITE"; readonly state: "ACTIVE" } | undefined;
  };
  readonly owners: {
    get(entityId: number): { readonly ownerPlayerId: number | null } | undefined;
  };
  readonly controllers: {
    get(entityId: number): { readonly controllerPlayerId: number | null } | undefined;
  };
};

export type ReplicationPlayerSlot = {
  playerId: number;
  connected: boolean;
};

export type ReplicationProjectionInput = {
  world: ReplicationWorldSource | null;
  roomId: string;
  phase: MatchPhase;
  /** Recipient session player id (per-client projection hook for ADR-007). */
  localPlayerId: number;
  players: readonly ReplicationPlayerSlot[];
};

/**
 * Projects simulation world fields into the protocol GameStateView.
 * Does not import Colyseus, Babylon, or the simulation package.
 *
 * Foundation replicates the same entity set to every player; `localPlayerId` is the
 * only per-recipient field today.
 */
export function projectWorldToGameStateView(input: ReplicationProjectionInput): GameStateView {
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

function projectEntity(
  world: ReplicationWorldSource,
  entityId: number,
  x: number,
  y: number,
): EntityView {
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
