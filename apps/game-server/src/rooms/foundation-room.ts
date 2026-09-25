import { Room, ServerError, type Client } from "colyseus";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  parseGameCommand,
  type CommandRejectedEvent,
  type GameEvent,
  type MatchPhase,
  type ProtocolMismatchEvent,
} from "@web-rts/protocol";
import { DEFAULT_TICK_HZ } from "@web-rts/simulation";
import {
  AUTH_ERROR_CODE,
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  MAX_PLAYERS,
  ROOM_FULL_ERROR_CODE,
  START_MESSAGE,
} from "../constants.js";
import { parseRoomJoinOptions } from "../join-options.js";
import { PlayerSlotRegistry } from "../player-slots.js";
import { SimulationHost } from "../simulation-host.js";

type ClientUserData = {
  playerId: number;
};

/**
 * Authoritative multiplayer room shell.
 * Owns session lifecycle and command intake; gameplay rules live in SimulationHost / World.
 */
export class FoundationRoom extends Room {
  override maxClients = MAX_PLAYERS;

  phase: MatchPhase = "LOBBY";
  seed = 0;
  mapId = "foundation";
  readonly slots = new PlayerSlotRegistry();
  simulationHost: SimulationHost | null = null;

  override onCreate(options: unknown): void {
    const parsed = parseRoomJoinOptions(options);
    if (parsed.success) {
      this.seed = parsed.data.seed;
      this.mapId = parsed.data.mapId;
    } else {
      // createRoom without versions is allowed for server-side test helpers;
      // clients still must pass versions through onAuth.
      const raw =
        options !== null && typeof options === "object" ? (options as Record<string, unknown>) : {};
      if (typeof raw["seed"] === "number" && Number.isFinite(raw["seed"])) {
        this.seed = Math.trunc(raw["seed"]);
      }
      if (typeof raw["mapId"] === "string" && raw["mapId"].length > 0) {
        this.mapId = raw["mapId"];
      }
    }

    this.setMetadata({
      phase: this.phase,
      seed: this.seed,
      mapId: this.mapId,
      maxPlayers: MAX_PLAYERS,
    });

    this.onMessage(COMMAND_MESSAGE, (client, payload) => {
      this.handleCommandMessage(client, payload);
    });

    this.onMessage(START_MESSAGE, (client) => {
      this.handleStartMessage(client);
    });
  }

  override onAuth(_client: Client, options: unknown): boolean {
    const parsed = parseRoomJoinOptions(options);
    if (!parsed.success) {
      if (parsed.reason === "protocol_mismatch" && parsed.compatibility) {
        const raw =
          options !== null && typeof options === "object"
            ? (options as Record<string, unknown>)
            : {};
        const actualProtocolVersion =
          typeof raw["protocolVersion"] === "number" ? raw["protocolVersion"] : -1;
        const actualGameDataVersion =
          typeof raw["gameDataVersion"] === "string" ? raw["gameDataVersion"] : "";
        const mismatch: ProtocolMismatchEvent = {
          type: "PROTOCOL_MISMATCH",
          expectedProtocolVersion: PROTOCOL_VERSION,
          actualProtocolVersion,
          expectedGameDataVersion: GAME_DATA_VERSION,
          actualGameDataVersion,
        };
        // HTTP-style auth error — never Colyseus-reserved 4010 (MAY_TRY_RECONNECT).
        throw new ServerError(AUTH_ERROR_CODE, JSON.stringify(mismatch));
      }
      throw new ServerError(AUTH_ERROR_CODE, parsed.reason);
    }
    return true;
  }

  override onJoin(client: Client, options?: unknown): void {
    void options;
    const slot = this.slots.allocate(client.sessionId);
    if (!slot) {
      // Application close code (≥4011); 4001 is reserved as SERVER_SHUTDOWN.
      throw new ServerError(ROOM_FULL_ERROR_CODE, "room_full");
    }
    (client as Client & { userData: ClientUserData }).userData = {
      playerId: slot.playerId,
    };
  }

  override onLeave(client: Client): void {
    // Colyseus 0.18 onLeave is permanent leave; free the slot until F8 reconnect.
    this.slots.release(client.sessionId);
  }

  override onDispose(): void {
    this.simulationHost = null;
    this.phase = "FINISHED";
  }

  /** Starts SimulationHost with configured seed/map and enters RUNNING. */
  startMatch(): boolean {
    if (this.phase !== "LOBBY" && this.phase !== "STARTING") {
      return false;
    }
    this.phase = "STARTING";
    this.simulationHost = new SimulationHost({
      seed: this.seed,
      mapId: this.mapId,
    });
    this.phase = "RUNNING";
    this.setMetadata({
      phase: this.phase,
      seed: this.seed,
      mapId: this.mapId,
      maxPlayers: MAX_PLAYERS,
    });

    // Drive fixed ticks at the simulation boundary (not gameplay rules).
    this.setFixedTimestep(() => {
      if (this.phase === "RUNNING" && this.simulationHost) {
        this.simulationHost.step();
      }
    }, DEFAULT_TICK_HZ);

    return true;
  }

  private handleStartMessage(client: Client): void {
    if (!this.slots.getBySessionId(client.sessionId)) {
      return;
    }
    if (!this.startMatch()) {
      this.sendEvent(client, {
        type: "COMMAND_REJECTED",
        commandId: "start",
        reason: "invalid_phase",
      });
    }
  }

  private handleCommandMessage(client: Client, payload: unknown): void {
    try {
      const slot = this.slots.getBySessionId(client.sessionId);
      if (!slot) {
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId: "unknown",
          reason: "no_session",
        });
        return;
      }

      const parsed = parseGameCommand(payload);
      if (!parsed.success) {
        const commandId =
          payload !== null &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>)["commandId"] === "string"
            ? ((payload as Record<string, unknown>)["commandId"] as string)
            : "unknown";
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId,
          reason: "invalid_schema",
        });
        return;
      }

      if (!this.simulationHost || this.phase !== "RUNNING") {
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId: parsed.data.commandId,
          reason: "not_running",
        });
        return;
      }

      // Identity is session-derived only (Finding I1 / AGENTS network rules).
      this.simulationHost.enqueueFromSession(parsed.data, {
        playerId: slot.playerId,
        sessionId: client.sessionId,
      });
    } catch {
      this.sendEvent(client, {
        type: "COMMAND_REJECTED",
        commandId: "unknown",
        reason: "internal_error",
      });
    }
  }

  private sendEvent(client: Client, event: GameEvent | CommandRejectedEvent): void {
    client.send(EVENT_MESSAGE, event);
  }
}
