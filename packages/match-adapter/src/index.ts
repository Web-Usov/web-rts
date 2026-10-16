import {
  MAX_MOVE_ENTITY_IDS,
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type CommandRejectedEvent,
  type EntityView,
  type GameCommand,
  type GameStateView,
  type MatchPhase,
  type PlayerSlotView,
} from "@web-rts/protocol";
import { createMatchRuntime, resolveSimulationConfig } from "@web-rts/simulation";
import type {
  CreateWorldOptions,
  MatchSetup,
  MatchRuntime,
  RuntimeConfig,
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
    // Foundation wire requires x/y. G11 will expose contained living entities.
    entities: (snapshot?.entities ?? [])
      .filter((entity) => entity.location.type === "WORLD")
      .map(toEntityView),
  };
}

export function toGameEvent(event: RuntimeEvent): CommandRejectedEvent | null {
  if (
    event.type !== "COMMAND_REJECTED" ||
    event.reason === "no_dropoff" ||
    event.reason === "invalid_resource" ||
    event.reason === "not_worker" ||
    event.reason === "not_builder" ||
    event.reason === "invalid_building" ||
    event.reason === "invalid_owner" ||
    event.reason === "insufficient_resources" ||
    event.reason === "invalid_placement" ||
    event.reason === "invalid_construction" ||
    event.reason === "construction_busy" ||
    event.reason === "already_building" ||
    event.reason === "entity_not_found" ||
    event.reason === "entity_not_spatial" ||
    event.reason === "not_controller" ||
    event.reason === "invalid_garrison_host" ||
    event.reason === "host_not_completed" ||
    event.reason === "ineligible_occupant" ||
    event.reason === "no_garrison_slot" ||
    event.reason === "not_contained" ||
    event.reason === "no_exit"
  )
    return null;
  return {
    type: "COMMAND_REJECTED",
    commandId: event.commandId,
    reason: event.reason,
  };
}

function toEntityView(entity: MatchEntitySnapshot): EntityView {
  if (entity.location.type !== "WORLD")
    throw new Error("Foundation wire requires a WORLD location");
  return {
    entityId: entity.entityId,
    kind: entity.kind,
    definitionId: entity.definitionId,
    x: entity.location.x,
    y: entity.location.y,
    ownerPlayerId: entity.ownerPlayerId,
    controllerPlayerId: entity.controllerPlayerId,
    objectiveType: entity.objectiveType,
    objectiveState: entity.objectiveState,
  };
}

/** Startup cross-package invariant belongs to the approved bridge (ADR-009). */
export function createGameplayRuntime(
  setup: MatchSetup,
  runtimeConfig: Partial<RuntimeConfig> = {},
  simulationOptions: Pick<CreateWorldOptions, "pathQueriesPerTick" | "maxPathQueriesPerTick"> = {},
): MatchRuntime {
  const config = resolveSimulationConfig(simulationOptions);
  if (MAX_MOVE_ENTITY_IDS > config.pathQueriesPerTick.commandBudget) {
    throw new RangeError("MAX_MOVE_ENTITY_IDS must be <= commandBudget");
  }
  return createMatchRuntime(setup, runtimeConfig, simulationOptions);
}
