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
import { projectGameStateView, toGameEvent, toSimulationCommand } from "@web-rts/match-adapter";
import {
  DEFAULT_TICK_HZ,
  createMatchRuntime,
  type MatchRuntime,
  type MatchSetup,
  type MatchSnapshot,
} from "@web-rts/simulation";
import {
  AUTH_ERROR_CODE,
  DEFAULT_RECONNECT_GRACE_SECONDS,
  MAX_PLAYERS,
  ROOM_FULL_ERROR_CODE,
} from "../constants.js";
import { parseRoomJoinOptions } from "../join-options.js";
import {
  createMatchLogRecord,
  writeMatchLog,
  type MatchLogContext,
  type MatchLogFields,
} from "../logging/match-log.js";
import {
  buildTickDiagnostic,
  isVerboseTickLoggingEnabled,
  type TickDiagnostic,
} from "../logging/tick-diagnostics.js";
import { PlayerSlotRegistry } from "../player-slots.js";

type ClientUserData = {
  playerId: number;
};

/**
 * Authoritative multiplayer room shell (ADR-009).
 * Owns session lifecycle, schema/session checks, and the tick scheduler. Gameplay
 * rules live in the shared MatchRuntime; match-adapter projects its snapshot.
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
  /**
   * Same rule as `reconnectGraceSeconds`: tests may replace it on the server room,
   * client payloads never reach it.
   */
  matchRuntimeFactory: (setup: MatchSetup) => MatchRuntime = createMatchRuntime;
  readonly slots = new PlayerSlotRegistry();
  matchRuntime: MatchRuntime | null = null;
  /** Latest measured simulation step. Updated every tick; verbose logging is separate. */
  lastTickDiagnostic: TickDiagnostic | null = null;

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

    this.publishMetadata();

    this.onMessage(COMMAND_MESSAGE, (client, payload) => {
      this.handleCommandMessage(client, payload);
    });

    this.onMessage(START_MESSAGE, (client) => {
      this.handleStartMessage(client);
    });

    this.onMessage(SYNC_MESSAGE, (client) => {
      this.sendState(client);
    });

    this.emitMatchLog({ level: "info", event: "room_created" });
  }

  override onAuth(client: Client, options: unknown): boolean {
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
        this.emitMatchLog(
          { level: "warn", event: "protocol_mismatch", reason: "protocol_mismatch" },
          { sessionId: client.sessionId },
        );
        // HTTP-style auth error — never Colyseus-reserved 4010 (MAY_TRY_RECONNECT).
        throw new ServerError(AUTH_ERROR_CODE, JSON.stringify(mismatch));
      }
      this.emitMatchLog(
        { level: "warn", event: "auth_rejected", reason: parsed.reason },
        { sessionId: client.sessionId },
      );
      throw new ServerError(AUTH_ERROR_CODE, parsed.reason);
    }
    return true;
  }

  override onJoin(client: Client, options?: unknown): void {
    void options;
    const slot = this.slots.allocate(client.sessionId);
    if (!slot) {
      this.emitMatchLog(
        { level: "warn", event: "join_rejected", reason: "room_full" },
        { sessionId: client.sessionId },
      );
      // Application close code (≥4011); 4001 is reserved as SERVER_SHUTDOWN.
      throw new ServerError(ROOM_FULL_ERROR_CODE, "room_full");
    }
    (client as Client & { userData: ClientUserData }).userData = {
      playerId: slot.playerId,
    };
    this.emitMatchLog(
      { level: "info", event: "player_joined" },
      { playerId: slot.playerId, sessionId: client.sessionId },
    );
    this.broadcastState();
  }

  /**
   * Unexpected disconnect (Colyseus 0.18). Consented `leave()` does not come here.
   * Broadcast the reserved slot before awaiting `allowReconnection`, because that
   * promise stays pending for the whole grace period.
   */
  override async onDrop(client: Client): Promise<void> {
    const slot = this.slots.getBySessionId(client.sessionId);
    this.slots.markDisconnected(client.sessionId);
    this.emitMatchLog(
      { level: "info", event: "player_dropped" },
      slot
        ? { playerId: slot.playerId, sessionId: client.sessionId }
        : { sessionId: client.sessionId },
    );
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
    this.emitMatchLog(
      { level: "info", event: "player_reconnected" },
      { playerId: slot.playerId, sessionId: client.sessionId },
    );
    this.broadcastState(client.sessionId);
  }

  /**
   * Permanent leave: consented Disconnect, or reconnect timeout after onDrop.
   * Discards the player's pending commands and frees the slot and active Controller.
   * Owner and the entity stay. A drop inside the grace period keeps the queue.
   */
  override async onLeave(client: Client): Promise<void> {
    const slot = this.slots.release(client.sessionId);
    if (slot) {
      this.matchRuntime?.removePlayer(slot.playerId);
      this.emitMatchLog(
        { level: "info", event: "player_left" },
        { playerId: slot.playerId, sessionId: client.sessionId },
      );
    } else {
      this.emitMatchLog({ level: "info", event: "player_left" }, { sessionId: client.sessionId });
    }
    this.broadcastState();
  }

  override onDispose(): void {
    this.emitMatchLog({ level: "info", event: "room_disposed" });
    this.matchRuntime = null;
    this.phase = "FINISHED";
  }

  /** Creates the shared MatchRuntime for the players present now and enters RUNNING. */
  startMatch(): boolean {
    if (this.phase !== "LOBBY" && this.phase !== "STARTING") {
      return false;
    }
    this.phase = "STARTING";
    const runtime = this.matchRuntimeFactory({
      seed: this.seed,
      mapId: this.mapId,
      participants: this.slots.list().map((slot) => ({ playerId: slot.playerId })),
    });
    this.matchRuntime = runtime;
    this.phase = "RUNNING";
    this.emitMatchLog({
      level: "info",
      event: "match_started",
      entityCount: runtime.readMetrics().entityCount,
    });
    this.publishMetadata();

    // Drive fixed ticks at the simulation boundary (not gameplay rules).
    this.setFixedTimestep(() => {
      this.runTick();
    }, DEFAULT_TICK_HZ);

    this.finishIfRuntimeFinished();
    this.broadcastState();
    return true;
  }

  private runTick(): void {
    const runtime = this.matchRuntime;
    if (this.phase !== "RUNNING" || !runtime) {
      return;
    }
    const diagnostic = buildTickDiagnostic({
      step: () => {
        runtime.step();
      },
      metrics: () => runtime.readMetrics(),
    });
    this.lastTickDiagnostic = diagnostic;
    if (isVerboseTickLoggingEnabled()) {
      this.emitMatchLog({
        level: "info",
        event: "simulation_tick",
        durationMs: diagnostic.durationMs,
        entityCount: diagnostic.entityCount,
        pendingCommandCount: diagnostic.pendingCommandCount,
      });
    }
    this.deliverRuntimeEvents(runtime);
    this.finishIfRuntimeFinished();
    this.broadcastState();
  }

  /** Routes recipient-addressed events to the player's current session. Offline players lose them. */
  private deliverRuntimeEvents(runtime: MatchRuntime): void {
    for (const event of runtime.drainEvents()) {
      const slot = this.slots
        .list()
        .find((candidate) => candidate.playerId === event.recipientPlayerId);
      this.emitMatchLog(
        {
          level: "warn",
          event: "command_rejected",
          reason: event.reason,
          commandId: event.commandId,
        },
        slot
          ? { playerId: slot.playerId, sessionId: slot.sessionId }
          : { playerId: event.recipientPlayerId },
      );
      if (!slot || !slot.connected) {
        continue;
      }
      const client = this.clients.find((candidate) => candidate.sessionId === slot.sessionId);
      if (client) {
        this.sendEvent(client, toGameEvent(event));
      }
    }
  }

  private finishIfRuntimeFinished(): void {
    if (this.phase !== "RUNNING" || this.matchRuntime?.status !== "FINISHED") {
      return;
    }
    this.phase = "FINISHED";
    this.emitMatchLog({ level: "info", event: "match_finished" });
    this.publishMetadata();
  }

  private publishMetadata(): void {
    this.setMetadata({
      phase: this.phase,
      seed: this.seed,
      mapId: this.mapId,
      maxPlayers: MAX_PLAYERS,
    });
  }

  private handleStartMessage(client: Client): void {
    if (!this.slots.getBySessionId(client.sessionId)) {
      return;
    }
    if (!this.startMatch()) {
      const slot = this.slots.getBySessionId(client.sessionId);
      this.emitMatchLog(
        {
          level: "warn",
          event: "command_rejected",
          reason: "invalid_phase",
          commandId: "start",
        },
        slot
          ? { playerId: slot.playerId, sessionId: client.sessionId }
          : { sessionId: client.sessionId },
      );
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
        this.emitMatchLog(
          {
            level: "warn",
            event: "command_rejected",
            reason: "no_session",
            commandId: "unknown",
          },
          { sessionId: client.sessionId },
        );
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
        this.emitMatchLog(
          {
            level: "warn",
            event: "command_rejected",
            reason: "invalid_schema",
            commandId,
          },
          { playerId: slot.playerId, sessionId: client.sessionId },
        );
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId,
          reason: "invalid_schema",
        });
        return;
      }

      const runtime = this.matchRuntime;
      if (!runtime || this.phase !== "RUNNING") {
        this.emitMatchLog(
          {
            level: "warn",
            event: "command_rejected",
            reason: "not_running",
            commandId: parsed.data.commandId,
          },
          { playerId: slot.playerId, sessionId: client.sessionId },
        );
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId: parsed.data.commandId,
          reason: "not_running",
        });
        return;
      }

      // Identity is session-derived only; gameplay validation runs on the tick boundary.
      const admission = runtime.submitCommand(
        { playerId: slot.playerId },
        toSimulationCommand(parsed.data),
      );
      if (!admission.accepted) {
        this.emitMatchLog(
          {
            level: "warn",
            event: "command_rejected",
            reason: admission.reason,
            commandId: parsed.data.commandId,
          },
          { playerId: slot.playerId, sessionId: client.sessionId },
        );
        this.sendEvent(client, {
          type: "COMMAND_REJECTED",
          commandId: parsed.data.commandId,
          reason: admission.reason,
        });
      }
    } catch (error) {
      const slot = this.slots.getBySessionId(client.sessionId);
      this.emitMatchLog(
        {
          level: "error",
          event: "internal_error",
          error: error instanceof Error ? error.message : "unknown",
        },
        slot
          ? { playerId: slot.playerId, sessionId: client.sessionId }
          : { sessionId: client.sessionId },
      );
      this.sendEvent(client, {
        type: "COMMAND_REJECTED",
        commandId: "unknown",
        reason: "internal_error",
      });
    }
  }

  private emitMatchLog(
    fields: MatchLogFields,
    identity?: { playerId?: number; sessionId?: string },
  ): void {
    const context: MatchLogContext = {
      roomId: this.roomId,
      tick: this.matchRuntime?.readMetrics().tick ?? 0,
    };
    if (identity?.playerId !== undefined) {
      context.playerId = identity.playerId;
    }
    if (identity?.sessionId !== undefined) {
      context.sessionId = identity.sessionId;
    }
    writeMatchLog(createMatchLogRecord(context, fields));
  }

  /** One transport-neutral snapshot per broadcast, then a projection per recipient. */
  broadcastState(exceptSessionId?: string): void {
    const snapshot = this.readSnapshot();
    for (const client of this.clients) {
      if (client.sessionId === exceptSessionId) {
        continue;
      }
      this.sendState(client, snapshot);
    }
  }

  /** One recipient. Used by broadcast and by the post-join sync request. */
  sendState(client: Client, snapshot: MatchSnapshot | null = this.readSnapshot()): void {
    const slot = this.slots.getBySessionId(client.sessionId);
    if (!slot) {
      return;
    }
    try {
      client.send(STATE_MESSAGE, this.buildStateView(slot.playerId, snapshot));
    } catch {
      // A client mid-handshake cannot accept a send yet. It asks again with SYNC.
    }
  }

  buildStateView(localPlayerId: number, snapshot: MatchSnapshot | null = this.readSnapshot()) {
    return projectGameStateView(
      snapshot,
      { localPlayerId },
      {
        roomId: this.roomId,
        phase: this.phase,
        players: this.slots.list().map((slot) => ({
          playerId: slot.playerId,
          connected: slot.connected,
        })),
      },
    );
  }

  private readSnapshot(): MatchSnapshot | null {
    return this.matchRuntime?.readSnapshot() ?? null;
  }

  private sendEvent(client: Client, event: GameEvent | CommandRejectedEvent): void {
    client.send(EVENT_MESSAGE, event);
  }
}
