import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type CommandRejectedEvent,
  type EntityView,
  type GameCommand,
  type GameStateView,
  type MatchPhase,
  type PlayerSlotView,
} from "@web-rts/protocol";
import type {
  MatchEntitySnapshot,
  MatchSnapshot,
  RuntimeEvent,
  SimulationCommand,
} from "@web-rts/simulation";

/**
 * The only production bridge between protocol and simulation (ADR-009).
 * Pure functions: no state, no gameplay validation.
 */

export type ProjectionRecipient = {
  readonly localPlayerId: number;
};

/** Shell-owned session metadata. It may differ between Local and Remote. */
export type ProjectionSession = {
  readonly roomId: string;
  readonly phase: MatchPhase;
  readonly players: readonly PlayerSlotView[];
};

/** Drops transport metadata (`clientSequence`). Identity is passed to the runtime separately. */
export function toSimulationCommand(command: GameCommand): SimulationCommand {
  return {
    type: "MOVE",
    commandId: command.commandId,
    entityIds: [...command.entityIds],
    target: { x: command.target.x, y: command.target.y },
  };
}

/** `snapshot` is null before START: the view carries session data and no entities. */
export function projectGameStateView(
  snapshot: MatchSnapshot | null,
  recipient: ProjectionRecipient,
  session: ProjectionSession,
): GameStateView {
  return {
    protocolVersion: PROTOCOL_VERSION,
    gameDataVersion: GAME_DATA_VERSION,
    roomId: session.roomId,
    tick: snapshot?.tick ?? 0,
    phase: session.phase,
    localPlayerId: recipient.localPlayerId,
    players: session.players.map((player) => ({
      playerId: player.playerId,
      connected: player.connected,
    })),
    entities: (snapshot?.entities ?? []).map(toEntityView),
  };
}

export function toGameEvent(event: RuntimeEvent): CommandRejectedEvent {
  return {
    type: "COMMAND_REJECTED",
    commandId: event.commandId,
    reason: event.reason,
  };
}

function toEntityView(entity: MatchEntitySnapshot): EntityView {
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
