import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  parseGameCommand,
  type EntityView,
  type GameCommand,
  type GameEvent,
  type GameStateView,
  type MatchPhase,
} from "@web-rts/protocol";
import {
  assessFoundationMove,
  createWorld,
  placeFoundationObjective,
  readWorldSnapshot,
  spawnFoundationUnits,
  type SimulationCommand,
  type World,
  type WorldEntitySnapshot,
} from "@web-rts/simulation";
import {
  LOCAL_PLAYER_ID,
  LOCAL_ROOM_ID,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
} from "./local-protocol.js";

/** Cancels the host tick timer. Gameplay time still advances only via World.step. */
export type LocalTickSchedule = (tick: () => void) => () => void;

export type LocalMatchRuntime = {
  handle(message: MainToWorkerMessage): void;
  dispose(): void;
};

/**
 * Worker-side foundation match. Uses the shared simulation, foundation placement,
 * and GameStateView projection. The interval that calls `step` is only a scheduler.
 */
export function createLocalMatchRuntime(
  post: (message: WorkerToMainMessage) => void,
  schedule: LocalTickSchedule,
): LocalMatchRuntime {
  let sessionId: number | null = null;
  let phase: MatchPhase = "LOBBY";
  let seed = 0;
  let world: World | null = null;
  let stopTicks: (() => void) | null = null;

  const publishState = (): void => {
    if (sessionId === null) {
      return;
    }
    post({
      type: "state",
      sessionId,
      state: projectLocalState(world, phase),
    });
  };

  const publishEvent = (event: GameEvent): void => {
    if (sessionId === null) {
      return;
    }
    post({ type: "event", sessionId, event });
  };

  const drainCommandRejections = (): void => {
    if (!world) {
      return;
    }
    for (const simEvent of world.drainEvents()) {
      if (simEvent.type !== "COMMAND_REJECTED") {
        continue;
      }
      publishEvent({
        type: "COMMAND_REJECTED",
        commandId: simEvent.commandId,
        reason: simEvent.reason,
      });
    }
  };

  const stopSchedule = (): void => {
    stopTicks?.();
    stopTicks = null;
  };

  const resetMatch = (): void => {
    stopSchedule();
    world = null;
    phase = "LOBBY";
    sessionId = null;
  };

  const rejectCommand = (commandId: string, reason: string): void => {
    publishEvent({ type: "COMMAND_REJECTED", commandId, reason });
  };

  const enqueueMove = (command: GameCommand): void => {
    if (!world || phase !== "RUNNING" || sessionId === null) {
      rejectCommand(command.commandId, "not_running");
      return;
    }

    const decision = assessFoundationMove(
      world,
      LOCAL_PLAYER_ID,
      command.entityIds,
      command.target,
    );
    if (!decision.ok) {
      rejectCommand(command.commandId, decision.reason);
      return;
    }

    const mapped: SimulationCommand = {
      type: "MOVE",
      commandId: command.commandId,
      entityIds: [...command.entityIds],
      target: { x: command.target.x, y: command.target.y },
    };
    world.enqueueCommand(mapped);
  };

  const handleConnect = (message: Extract<MainToWorkerMessage, { type: "connect" }>): void => {
    resetMatch();
    const compatibility = checkProtocolCompatibility({
      protocolVersion: message.protocolVersion,
      gameDataVersion: message.gameDataVersion,
      expectedProtocolVersion: PROTOCOL_VERSION,
      expectedGameDataVersion: GAME_DATA_VERSION,
    });
    sessionId = message.sessionId;
    if (!compatibility.compatible) {
      publishEvent({
        type: "PROTOCOL_MISMATCH",
        expectedProtocolVersion: PROTOCOL_VERSION,
        actualProtocolVersion: message.protocolVersion,
        expectedGameDataVersion: GAME_DATA_VERSION,
        actualGameDataVersion: message.gameDataVersion,
      });
      post({ type: "failed", sessionId: message.sessionId, message: "protocol_mismatch" });
      sessionId = null;
      return;
    }

    seed = Number.isFinite(message.seed) ? Math.trunc(message.seed) : 0;
    phase = "LOBBY";
    post({ type: "connected", sessionId: message.sessionId, roomId: LOCAL_ROOM_ID });
    publishState();
  };

  const handleStart = (message: Extract<MainToWorkerMessage, { type: "start" }>): void => {
    if (sessionId !== message.sessionId) {
      return;
    }
    if (phase !== "LOBBY" && phase !== "STARTING") {
      rejectCommand("start", "invalid_phase");
      return;
    }

    phase = "STARTING";
    world = createWorld({ seed });
    spawnFoundationUnits(world, [LOCAL_PLAYER_ID]);
    placeFoundationObjective(world);
    drainCommandRejections();
    phase = "RUNNING";
    stopSchedule();
    stopTicks = schedule(() => {
      if (!world || phase !== "RUNNING") {
        return;
      }
      world.step();
      drainCommandRejections();
      publishState();
    });
    publishState();
  };

  const handleCommand = (message: Extract<MainToWorkerMessage, { type: "command" }>): void => {
    if (sessionId !== message.sessionId) {
      return;
    }
    const parsed = parseGameCommand(message.command);
    if (!parsed.success) {
      const commandId = readCommandId(message.command);
      rejectCommand(commandId, "invalid_schema");
      return;
    }
    enqueueMove(parsed.data);
  };

  return {
    handle(message: MainToWorkerMessage): void {
      if (message.type === "disconnect") {
        if (sessionId === message.sessionId) {
          resetMatch();
        }
        return;
      }
      if (message.type === "connect") {
        handleConnect(message);
        return;
      }
      if (message.type === "start") {
        handleStart(message);
        return;
      }
      handleCommand(message);
    },
    dispose(): void {
      resetMatch();
    },
  };
}

function projectLocalState(world: World | null, phase: MatchPhase): GameStateView {
  const snapshot = world ? readWorldSnapshot(world) : null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    gameDataVersion: GAME_DATA_VERSION,
    roomId: LOCAL_ROOM_ID,
    tick: snapshot?.tick ?? 0,
    phase,
    localPlayerId: LOCAL_PLAYER_ID,
    players: [{ playerId: LOCAL_PLAYER_ID, connected: true }],
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

function readCommandId(payload: unknown): string {
  if (
    payload !== null &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>)["commandId"] === "string"
  ) {
    return (payload as Record<string, unknown>)["commandId"] as string;
  }
  return "unknown";
}
