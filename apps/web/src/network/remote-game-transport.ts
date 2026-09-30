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
import {
  createSessionStorageResumeTokenStore,
  type OpaqueResumeTokenStore,
} from "./resume-token-store.js";

export const DEFAULT_GAME_SERVER_PORT = 2567;
export const DEFAULT_GAME_SERVER_URL = `http://localhost:${DEFAULT_GAME_SERVER_PORT}`;

export type GameServerBrowserLocation = {
  protocol: string;
  hostname: string;
};

export type GameServerEndpointConfig = {
  explicitUrl?: string | undefined;
  port?: string | number | undefined;
  location?: GameServerBrowserLocation | undefined;
};

/**
 * Resolves the browser-visible game-server endpoint.
 *
 * Docker/LAN builds intentionally avoid hard-coding the Docker host address:
 * when no explicit URL is configured, the client reuses the hostname that
 * served the page and only supplies the configured game-server port.
 */
export function resolveGameServerEndpoint(config: GameServerEndpointConfig = {}): string {
  const explicitUrl = config.explicitUrl?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const port = parseGameServerPort(config.port);
  const hostname = config.location?.hostname.trim();
  if (hostname) {
    const protocol = config.location?.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${hostname}:${port}`;
  }

  return `http://localhost:${port}`;
}

function parseGameServerPort(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= 65_535
      ? value
      : DEFAULT_GAME_SERVER_PORT;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return DEFAULT_GAME_SERVER_PORT;
  }

  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? parsed
    : DEFAULT_GAME_SERVER_PORT;
}

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

  constructor(options: RemoteGameTransportOptions = {}) {
    const fromEnv =
      typeof import.meta !== "undefined" &&
      typeof import.meta.env?.VITE_GAME_SERVER_URL === "string"
        ? import.meta.env.VITE_GAME_SERVER_URL
        : undefined;
    const portFromEnv =
      typeof import.meta !== "undefined" &&
      typeof import.meta.env?.VITE_GAME_SERVER_PORT === "string"
        ? import.meta.env.VITE_GAME_SERVER_PORT
        : undefined;
    const browserLocation =
      typeof window !== "undefined"
        ? { protocol: window.location.protocol, hostname: window.location.hostname }
        : undefined;

    this.defaultEndpoint =
      options.defaultEndpoint ??
      resolveGameServerEndpoint({
        explicitUrl: fromEnv,
        port: portFromEnv,
        location: browserLocation,
      });
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
      this.resumeTokenStore.clear();
      this.emit(code === CloseCode.CONSENTED ? "left" : "expired");
    });

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

let browserTransport: RemoteGameTransport | null = null;

/**
 * One transport for the page. React StrictMode remounts must not consented-leave
 * the session or wipe the resume token.
 */
export function getBrowserGameTransport(): RemoteGameTransport {
  browserTransport ??= new RemoteGameTransport();
  return browserTransport;
}
