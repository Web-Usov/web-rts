import { Room, ServerError, type Client } from "colyseus";
import {
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  START_MESSAGE,
  STATE_MESSAGE,
  SYNC_MESSAGE,
  parseGameCommand,
  type CommandRejectedEvent,
  type GameEvent,
  type MatchPhase,
  type ProtocolMismatchEvent,
} from "@web-rts/protocol";
import { DEFAULT_TICK_HZ } from "@web-rts/simulation";
import {
  AUTH_ERROR_CODE,
  DEFAULT_RECONNECT_GRACE_SECONDS,
  MAX_PLAYERS,
  ROOM_FULL_ERROR_CODE,
} from "../constants.js";
import { parseRoomJoinOptions } from "../join-options.js";
import { PlayerSlotRegistry } from "../player-slots.js";
import { projectWorldToGameStateView } from "../replication-adapter.js";
import { SimulationHost } from "../simulation-host.js";

type ClientUserData = {
  playerId: number;
};

/**
 * Authoritative multiplayer room shell.
 * Owns session lifecycle and command intake; gameplay rules live in SimulationHost / World.
 * Replication projects World → GameStateView (not Colyseus Schema as simulation state).
 */
export class FoundationRoom extends Room {
  override maxClients = MAX_PLAYERS;

  phase: MatchPhase = "LOBBY";
  seed = 0;
  mapId = "foundation";
  /**
   * Unexpected-disconnect reservation in seconds. Production default is 30.
   * Integration tests may assign a shorter value on this server instance.
   * Join/create payloads are never copied onto this field.
   */
  reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;
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

    this.onMessage(SYNC_MESSAGE, (client) => {
      this.sendState(client);
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
    this.broadcastState();
  }

  /**
   * Unexpected disconnect (Colyseus 0.18). Consented `leave()` does not come here.
   * Broadcast the reserved slot before awaiting `allowReconnection`, because that
   * promise stays pending for the whole grace period.
   */
  override async onDrop(client: Client): Promise<void> {
    this.slots.markDisconnected(client.sessionId);
    this.broadcastState();
    try {
      await this.allowReconnection(client, this.reconnectGraceSeconds);
    } catch {
      // Timeout or rejected resume. Permanent cleanup runs in onLeave.
    }
  }

  /**
   * Same Colyseus sessionId and player slot. Does not allocate a new player.
   * The reconnecting client is skipped here: its socket may not have JOIN yet,
   * and it requests a fresh snapshot after its own listeners are attached.
   */
  override onReconnect(client: Client): void {
    const slot = this.slots.getBySessionId(client.sessionId);
    if (!slot) {
      return;
    }
    this.slots.markConnected(client.sessionId);
    this.broadcastState(client.sessionId);
  }

  /**
   * Permanent leave: consented Disconnect, or reconnect timeout after onDrop.
   * Frees the slot and active Controller. Owner and the entity stay.
   */
  override async onLeave(client: Client): Promise<void> {
    const slot = this.slots.release(client.sessionId);
    if (slot) {
      this.simulationHost?.releaseControlForPlayer(slot.playerId);
    }
    this.broadcastState();
  }

  override onDispose(): void {
    this.simulationHost = null;
    this.phase = "FINISHED";
  }

  /** Starts SimulationHost, spawns primitive units, and enters RUNNING. */
  startMatch(): boolean {
    if (this.phase !== "LOBBY" && this.phase !== "STARTING") {
      return false;
    }
    this.phase = "STARTING";
    this.simulationHost = new SimulationHost({
      seed: this.seed,
      mapId: this.mapId,
    });
    const playerIds = this.slots.list().map((slot) => slot.playerId);
    this.simulationHost.bootstrapMatch(playerIds);
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
        this.broadcastState();
      }
    }, DEFAULT_TICK_HZ);

    this.broadcastState();
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
      const result = this.simulationHost.enqueueFromSession(parsed.data, {
        playerId: slot.playerId,
        sessionId: client.sessionId,
      });

      if (!result.ok) {
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId: parsed.data.commandId,
          reason: result.reason,
        });
      }
    } catch {
      this.sendEvent(client, {
        type: "COMMAND_REJECTED",
        commandId: "unknown",
        reason: "internal_error",
      });
    }
  }

  /** Per-client GameStateView projection (localPlayerId differs; entities shared in F5). */
  broadcastState(exceptSessionId?: string): void {
    for (const client of this.clients) {
      if (client.sessionId === exceptSessionId) {
        continue;
      }
      this.sendState(client);
    }
  }

  /** One recipient. Used by broadcast and by the post-join sync request. */
  sendState(client: Client): void {
    const slot = this.slots.getBySessionId(client.sessionId);
    if (!slot) {
      return;
    }
    try {
      client.send(STATE_MESSAGE, this.buildStateView(slot.playerId));
    } catch {
      // A client mid-handshake cannot accept a send yet. It asks again with SYNC.
    }
  }

  buildStateView(localPlayerId: number) {
    const players = this.slots.list().map((slot) => ({
      playerId: slot.playerId,
      connected: slot.connected,
    }));

    return projectWorldToGameStateView({
      world: this.simulationHost?.world ?? null,
      roomId: this.roomId,
      phase: this.phase,
      localPlayerId,
      players,
    });
  }

  private sendEvent(client: Client, event: GameEvent | CommandRejectedEvent): void {
    client.send(EVENT_MESSAGE, event);
  }
}
