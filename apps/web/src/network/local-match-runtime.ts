import { createGameplayRuntime } from "@web-rts/match-adapter";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  parseGameCommand,
  readRejectedCommandId,
  type GameEvent,
  type MatchPhase,
} from "@web-rts/protocol";
import { projectGameStateView, toGameEvent, toSimulationCommand } from "@web-rts/match-adapter";
import { type MatchRuntime, type MatchSetup } from "@web-rts/simulation";
import {
  LOCAL_PLAYER_ID,
  LOCAL_ROOM_ID,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
} from "./local-protocol.js";

/** Cancels the host tick timer. Gameplay time still advances only via MatchRuntime.step. */
export type LocalTickSchedule = (tick: () => void) => () => void;

export type LocalMatchRuntime = {
  handle(message: MainToWorkerMessage): void;
  dispose(): void;
};

export type LocalMatchRuntimeOptions = {
  /** Tests may substitute the shared runtime; production uses createMatchRuntime. */
  createRuntime?: (setup: MatchSetup) => MatchRuntime;
};

/**
 * Worker-side session shell over the shared MatchRuntime. Owns the local lobby,
 * the trusted Local PlayerId, and the tick scheduler; gameplay rules and
 * projection are shared with the Remote room.
 */
export function createLocalMatchRuntime(
  post: (message: WorkerToMainMessage) => void,
  schedule: LocalTickSchedule,
  options: LocalMatchRuntimeOptions = {},
): LocalMatchRuntime {
  const createRuntime = options.createRuntime ?? createGameplayRuntime;
  let sessionId: number | null = null;
  let phase: MatchPhase = "LOBBY";
  let seed = 0;
  let mapId = "";
  let runtime: MatchRuntime | null = null;
  let stopTicks: (() => void) | null = null;

  const publishState = (): void => {
    if (sessionId === null) {
      return;
    }
    post({
      type: "state",
      sessionId,
      state: projectGameStateView(
        runtime?.readSnapshot() ?? null,
        { localPlayerId: LOCAL_PLAYER_ID },
        {
          roomId: LOCAL_ROOM_ID,
          phase,
          players: [{ playerId: LOCAL_PLAYER_ID, connected: true }],
        },
      ),
    });
  };

  const publishEvent = (event: GameEvent): void => {
    if (sessionId === null) {
      return;
    }
    post({ type: "event", sessionId, event });
  };

  const deliverRuntimeEvents = (active: MatchRuntime): void => {
    for (const event of active.drainEvents()) {
      if (event.recipientPlayerId === LOCAL_PLAYER_ID) {
        publishEvent(toGameEvent(event));
      }
    }
  };

  const stopSchedule = (): void => {
    stopTicks?.();
    stopTicks = null;
  };

  const finishIfRuntimeFinished = (): void => {
    if (phase === "RUNNING" && runtime?.status === "FINISHED") {
      phase = "FINISHED";
      stopSchedule();
    }
  };

  const resetMatch = (): void => {
    stopSchedule();
    runtime = null;
    phase = "LOBBY";
    sessionId = null;
  };

  const rejectCommand = (commandId: string, reason: string): void => {
    publishEvent({ type: "COMMAND_REJECTED", commandId, reason });
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
    mapId = message.mapId;
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
    const active = createRuntime({
      seed,
      mapId,
      participants: [{ playerId: LOCAL_PLAYER_ID }],
    });
    runtime = active;
    phase = "RUNNING";
    stopSchedule();
    stopTicks = schedule(() => {
      if (runtime !== active || phase !== "RUNNING") {
        return;
      }
      active.step();
      deliverRuntimeEvents(active);
      finishIfRuntimeFinished();
      publishState();
    });
    finishIfRuntimeFinished();
    publishState();
  };

  const handleCommand = (message: Extract<MainToWorkerMessage, { type: "command" }>): void => {
    if (sessionId !== message.sessionId) {
      return;
    }
    const parsed = parseGameCommand(message.command);
    if (!parsed.success) {
      rejectCommand(readRejectedCommandId(message.command), "invalid_schema");
      return;
    }
    if (!runtime || phase !== "RUNNING") {
      rejectCommand(parsed.data.commandId, "not_running");
      return;
    }
    const admission = runtime.submitCommand(
      { playerId: LOCAL_PLAYER_ID },
      toSimulationCommand(parsed.data),
    );
    if (!admission.accepted) {
      rejectCommand(parsed.data.commandId, admission.reason);
    }
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
