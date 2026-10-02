import {
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
import type { MainToWorkerMessage, WorkerToMainMessage } from "./local-protocol.js";

export interface LocalWorkerPort {
  postMessage(message: MainToWorkerMessage): void;
  terminate(): void;
  setOnMessage(listener: (message: WorkerToMainMessage) => void): void;
}

export type LocalWorkerFactory = () => LocalWorkerPort;

export type LocalGameTransportOptions = {
  workerFactory: LocalWorkerFactory;
};

/**
 * In-browser GameTransport. Presentation sees the same contract as the remote adapter.
 * Simulation runs in the worker supplied by `workerFactory`.
 */
export class LocalGameTransport implements GameTransport {
  private readonly workerFactory: LocalWorkerFactory;
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private worker: LocalWorkerPort | null = null;
  private sessionId: number | null = null;
  private nextSessionId = 0;
  private roomId: string | null = null;
  private acceptMessages = false;
  private pendingConnect: {
    sessionId: number;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(options: LocalGameTransportOptions) {
    this.workerFactory = options.workerFactory;
  }

  get connectedRoomId(): string | null {
    return this.roomId;
  }

  /** Local skeleton has no remote resume token. */
  hasResumeToken(): boolean {
    return false;
  }

  /**
   * Local skeleton does not restore a previous session.
   * This never creates a match or a player.
   */
  async resumePreviousSession(options?: ResumeSessionOptions): Promise<ResumeSessionResult> {
    // A remote endpoint cannot restore this skeleton. No match is created.
    void options;
    return { status: "absent" };
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.stopWorker({ emitLeft: false });

    const sessionId = this.nextSessionId + 1;
    this.nextSessionId = sessionId;
    const worker = this.workerFactory();
    this.worker = worker;
    this.sessionId = sessionId;
    this.acceptMessages = true;

    worker.setOnMessage((message) => {
      this.onWorkerMessage(sessionId, message);
    });

    const connected = new Promise<void>((resolve, reject) => {
      this.pendingConnect = { sessionId, resolve, reject };
    });

    const seed =
      typeof options.seed === "number" && Number.isFinite(options.seed)
        ? Math.trunc(options.seed)
        : 0;
    const mapId =
      typeof options.mapId === "string" && options.mapId.length > 0 ? options.mapId : "foundation";

    worker.postMessage({
      type: "connect",
      sessionId,
      protocolVersion: options.protocolVersion,
      gameDataVersion: options.gameDataVersion,
      seed,
      mapId,
    });

    await connected;
  }

  sendCommand(command: GameCommand): void {
    if (!this.worker || this.sessionId === null) {
      return;
    }
    this.worker.postMessage({
      type: "command",
      sessionId: this.sessionId,
      command,
    });
  }

  /** Leaves LOBBY through the same Start message the remote room understands. */
  startMatch(): void {
    if (!this.worker || this.sessionId === null) {
      return;
    }
    this.worker.postMessage({ type: "start", sessionId: this.sessionId });
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

  /** Local simulation has no network round trip. */
  readRoundTripMs(): number | null {
    return null;
  }

  async disconnect(): Promise<void> {
    this.stopWorker({ emitLeft: true });
  }

  private onWorkerMessage(sessionId: number, message: WorkerToMainMessage): void {
    if (!this.acceptMessages || this.sessionId !== sessionId || message.sessionId !== sessionId) {
      return;
    }

    if (message.type === "connected") {
      this.roomId = message.roomId;
      this.pendingConnect?.resolve();
      this.pendingConnect = null;
      return;
    }

    if (message.type === "failed") {
      this.pendingConnect?.reject(new Error(message.message));
      this.pendingConnect = null;
      return;
    }

    if (message.type === "state") {
      const parsed = parseGameStateView(message.state);
      if (!parsed.success) {
        return;
      }
      for (const listener of this.stateListeners) {
        listener(parsed.data);
      }
      return;
    }

    const parsed = parseGameEvent(message.event);
    if (!parsed.success) {
      return;
    }
    for (const listener of this.eventListeners) {
      listener(parsed.data);
    }
  }

  private stopWorker(options: { emitLeft: boolean }): void {
    const worker = this.worker;
    const sessionId = this.sessionId;
    this.acceptMessages = false;
    this.worker = null;
    this.sessionId = null;
    this.roomId = null;
    const pending = this.pendingConnect;
    this.pendingConnect = null;
    pending?.reject(new Error("disconnected"));

    if (worker && sessionId !== null) {
      try {
        worker.postMessage({ type: "disconnect", sessionId });
      } catch {
        /* worker may already be gone */
      }
      worker.terminate();
    }

    if (options.emitLeft) {
      this.emit("left");
    }
  }

  private emit(notice: TransportConnectionNotice): void {
    for (const listener of this.connectionListeners) {
      listener(notice);
    }
  }
}

let browserLocalTransport: LocalGameTransport | null = null;

/**
 * One local transport for the page. React StrictMode remounts must not spawn
 * a second worker or tear the session down.
 */
export function getBrowserLocalGameTransport(
  workerFactory: LocalWorkerFactory,
): LocalGameTransport {
  browserLocalTransport ??= new LocalGameTransport({ workerFactory });
  return browserLocalTransport;
}
