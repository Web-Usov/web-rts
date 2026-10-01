import { Client, CloseCode, type Room } from "@colyseus/sdk";
import {
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  START_MESSAGE,
  STATE_MESSAGE,
  SYNC_MESSAGE,
  parseGameEvent,
  parseGameStateView,
  type ConnectOptions,
  type ConnectionListener,
  type EventListener,
  type GameCommand,
  type GameTransport,
  type ResumeSessionOptions,
  type ResumeSessionResult,
  type StateListener,
  type TransportConnectionNotice,
  type Unsubscribe,
} from "@web-rts/protocol";
import { resolveGameServerEndpoint } from "./game-server-endpoint.js";
import { RoundTripMonitor, probeLiveRoomPing } from "./round-trip.js";
import {
  createSessionStorageResumeTokenStore,
  type OpaqueResumeTokenStore,
} from "./resume-token-store.js";

export { DEFAULT_GAME_SERVER_URL } from "./game-server-endpoint.js";

export const FOUNDATION_ROOM_NAME = "foundation";

export type RemoteGameTransportOptions = {
  defaultEndpoint?: string;
  resumeTokenStore?: OpaqueResumeTokenStore;
};

/**
 * Colyseus adapter behind {@link GameTransport}.
 * Presentation/UI must not import `@colyseus/sdk` directly.
 *
 * Create, join, and manual reconnect all go through {@link attachRoom} so
 * STATE/EVENT listeners exist before the post-attach SYNC request.
 */
export class RemoteGameTransport implements GameTransport {
  private client: Client | null = null;
  private room: Room | null = null;
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private readonly defaultEndpoint: string;
  private readonly resumeTokenStore: OpaqueResumeTokenStore;
  private roomId: string | null = null;
  private resumeInFlight: Promise<ResumeSessionResult> | null = null;
  private readonly roundTrip = new RoundTripMonitor(1_000);

  constructor(options: RemoteGameTransportOptions = {}) {
    this.defaultEndpoint = options.defaultEndpoint ?? resolveConfiguredGameServerEndpoint();
    this.resumeTokenStore = options.resumeTokenStore ?? createSessionStorageResumeTokenStore();
  }

  get connectedRoomId(): string | null {
    return this.roomId;
  }

  /** True when this tab still has an opaque resume token. The token itself is not exposed. */
  hasResumeToken(): boolean {
    return this.resumeTokenStore.read() !== null;
  }

  async connect(options: ConnectOptions): Promise<void> {
    await this.closeCurrentRoom({ clearToken: true });

    const endpoint = options.endpoint ?? this.defaultEndpoint;
    this.client = new Client(endpoint);

    const joinOptions: Record<string, unknown> = {
      protocolVersion: options.protocolVersion,
      gameDataVersion: options.gameDataVersion,
    };
    if (typeof options.seed === "number") {
      joinOptions["seed"] = options.seed;
    }
    if (typeof options.mapId === "string") {
      joinOptions["mapId"] = options.mapId;
    }

    const room =
      options.createRoom || !options.roomId
        ? await this.client.create(FOUNDATION_ROOM_NAME, joinOptions)
        : await this.client.joinById(options.roomId, joinOptions);
    this.attachRoom(room);
  }

  /**
   * Restores the previous player context from the opaque session token.
   * Failure clears the token and does not create a room or a new player.
   */
  async resumePreviousSession(options: ResumeSessionOptions = {}): Promise<ResumeSessionResult> {
    const endpoint = options.endpoint ?? this.defaultEndpoint;
    if (this.resumeInFlight) {
      const result = await this.resumeInFlight;
      this.sendSync();
      return result;
    }
    if (this.room) {
      this.sendSync();
      return { status: "restored" };
    }

    const token = this.resumeTokenStore.read();
    if (!token) {
      return { status: "absent" };
    }

    this.resumeInFlight = this.resumeWithToken(token, endpoint);
    try {
      return await this.resumeInFlight;
    } finally {
      this.resumeInFlight = null;
    }
  }

  sendCommand(command: GameCommand): void {
    if (!this.room) {
      return;
    }
    this.room.send(COMMAND_MESSAGE, command);
  }

  /** Asks the server to leave LOBBY and start the foundation match. */
  startMatch(): void {
    if (!this.room) {
      return;
    }
    this.room.send(START_MESSAGE, {});
  }

  subscribeState(listener: StateListener): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribeEvent(listener: EventListener): Unsubscribe {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeConnection(listener: ConnectionListener): Unsubscribe {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /** Cached Colyseus `Room.ping` sample. `null` before a live room or after it closes. */
  readRoundTripMs(): number | null {
    return this.roundTrip.read();
  }

  /** Consented leave. Frees the server slot immediately and deletes the resume token. */
  async disconnect(): Promise<void> {
    await this.closeCurrentRoom({ clearToken: true });
    this.emit("left");
  }

  private async resumeWithToken(token: string, endpoint: string): Promise<ResumeSessionResult> {
    this.emit("reconnecting");
    try {
      this.client = new Client(endpoint);
      const room = await this.client.reconnect(token);
      this.attachRoom(room);
      this.emit("reconnected");
      return { status: "restored" };
    } catch {
      this.resumeTokenStore.clear();
      this.room = null;
      this.roomId = null;
      this.client = null;
      this.emit("expired");
      return { status: "expired" };
    }
  }

  /**
   * Shared listener setup for create, join, and manual reconnect.
   * SYNC is sent only after STATE/EVENT handlers exist (F5).
   */
  private attachRoom(room: Room): void {
    this.room = room;
    this.roomId = room.roomId;
    // SDK default skips automatic reconnect during the first 5s and then fires
    // onLeave. That would discard a server reservation that is still inside grace.
    room.reconnection.minUptime = 0;
    this.persistRoomToken(room);

    room.onMessage(STATE_MESSAGE, (payload: unknown) => {
      const parsed = parseGameStateView(payload);
      if (!parsed.success) {
        return;
      }
      for (const listener of this.stateListeners) {
        listener(parsed.data);
      }
    });
    room.onMessage(EVENT_MESSAGE, (payload: unknown) => {
      const parsed = parseGameEvent(payload);
      if (!parsed.success) {
        return;
      }
      for (const listener of this.eventListeners) {
        listener(parsed.data);
      }
    });

    room.onDrop(() => {
      this.emit("reconnecting");
    });
    room.onReconnect(() => {
      // JOIN_ROOM assigns the rotated token after onReconnect listeners return.
      queueMicrotask(() => {
        if (this.room !== room) {
          return;
        }
        this.persistRoomToken(room);
        this.sendSync();
        this.emit("reconnected");
      });
    });
    room.onLeave((code) => {
      if (this.room !== room) {
        return;
      }
      this.room = null;
      this.roomId = null;
      this.client = null;
      this.roundTrip.stop();
      this.resumeTokenStore.clear();
      this.emit(code === CloseCode.CONSENTED ? "left" : "expired");
    });
    this.roundTrip.start(() => probeLiveRoomPing(room));

    this.sendSync();
  }

  private persistRoomToken(room: Room): void {
    const token = room.reconnectionToken;
    if (typeof token !== "string" || !token.includes(":")) {
      return;
    }
    this.resumeTokenStore.write(token);
  }

  private sendSync(): void {
    if (!this.room) {
      return;
    }
    try {
      this.room.send(SYNC_MESSAGE, {});
    } catch {
      /* socket may still be settling */
    }
  }

  private async closeCurrentRoom(options: { clearToken: boolean }): Promise<void> {
    if (options.clearToken) {
      this.resumeTokenStore.clear();
    }
    const room = this.room;
    this.room = null;
    this.roomId = null;
    this.client = null;
    this.roundTrip.stop();
    if (!room) {
      return;
    }
    room.reconnection.enabled = false;
    try {
      await room.leave(true);
    } catch {
      /* ignore disconnect races */
    }
  }

  private emit(notice: TransportConnectionNotice): void {
    for (const listener of this.connectionListeners) {
      listener(notice);
    }
  }
}

function readViteString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Per-call `ConnectOptions.endpoint` still wins inside connect/resume.
 * This value is the next default: explicit Vite URL, then page hostname + port.
 */
function resolveConfiguredGameServerEndpoint(): string {
  const env = typeof import.meta === "undefined" ? undefined : import.meta.env;
  const pageHostname = typeof window === "undefined" ? undefined : window.location.hostname;
  return resolveGameServerEndpoint({
    explicitUrl: readViteString(env?.VITE_GAME_SERVER_URL),
    configuredPort: readViteString(env?.VITE_GAME_SERVER_PORT),
    pageHostname,
  });
}

let browserTransport: RemoteGameTransport | null = null;

/**
 * One transport for the page. React StrictMode remounts must not consented-leave
 * the session or wipe the resume token.
 */
export function getBrowserGameTransport(): RemoteGameTransport {
  browserTransport ??= new RemoteGameTransport();
  return browserTransport;
}
