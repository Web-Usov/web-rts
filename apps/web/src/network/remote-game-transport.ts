import { Client, type Room } from "@colyseus/sdk";
import {
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  START_MESSAGE,
  STATE_MESSAGE,
  SYNC_MESSAGE,
  parseGameEvent,
  parseGameStateView,
  type ConnectOptions,
  type EventListener,
  type GameCommand,
  type GameTransport,
  type StateListener,
  type Unsubscribe,
} from "@web-rts/protocol";

/** Dev default; override via ConnectOptions.endpoint or VITE_GAME_SERVER_URL (F9/Docker/LAN). */
export const DEFAULT_GAME_SERVER_URL = "http://localhost:2567";

export const FOUNDATION_ROOM_NAME = "foundation";

export type RemoteGameTransportOptions = {
  defaultEndpoint?: string;
};

/**
 * Colyseus adapter behind {@link GameTransport}.
 * Presentation/UI must not import `@colyseus/sdk` directly.
 */
export class RemoteGameTransport implements GameTransport {
  private client: Client | null = null;
  private room: Room | null = null;
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly defaultEndpoint: string;
  private roomId: string | null = null;

  constructor(options: RemoteGameTransportOptions = {}) {
    const fromEnv =
      typeof import.meta !== "undefined" &&
      typeof import.meta.env?.VITE_GAME_SERVER_URL === "string"
        ? import.meta.env.VITE_GAME_SERVER_URL
        : undefined;
    this.defaultEndpoint = options.defaultEndpoint ?? fromEnv ?? DEFAULT_GAME_SERVER_URL;
  }

  get connectedRoomId(): string | null {
    return this.roomId;
  }

  async connect(options: ConnectOptions): Promise<void> {
    await this.disconnect();

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

    if (options.createRoom || !options.roomId) {
      this.room = await this.client.create(FOUNDATION_ROOM_NAME, joinOptions);
    } else {
      this.room = await this.client.joinById(options.roomId, joinOptions);
    }

    this.roomId = this.room.roomId;
    this.room.onMessage(STATE_MESSAGE, (payload: unknown) => {
      const parsed = parseGameStateView(payload);
      if (!parsed.success) {
        return;
      }
      for (const listener of this.stateListeners) {
        listener(parsed.data);
      }
    });
    this.room.onMessage(EVENT_MESSAGE, (payload: unknown) => {
      const parsed = parseGameEvent(payload);
      if (!parsed.success) {
        return;
      }
      for (const listener of this.eventListeners) {
        listener(parsed.data);
      }
    });

    // onJoin already broadcast a snapshot; the SDK drops it if this handler
    // was not registered yet. Ask again now that listeners exist.
    this.room.send(SYNC_MESSAGE, {});
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

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.roomId = null;
    this.client = null;
    if (room) {
      try {
        await room.leave();
      } catch {
        /* ignore disconnect races */
      }
    }
  }
}
