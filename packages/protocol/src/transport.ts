import type { GameCommand } from "./commands.js";
import type { GameEvent } from "./events.js";
import type { GameStateView } from "./state.js";

/**
 * Options for establishing a local or remote match session via GameTransport.
 * Concrete remote fields (endpoint, room options) are filled by adapters.
 * Remote endpoint defaults live in the adapter: explicit URL, then the page
 * hostname and game-server port, so Docker/LAN does not hardcode localhost.
 */
export type ConnectOptions = {
  protocolVersion: number;
  gameDataVersion: string;
  roomId?: string;
  createRoom?: boolean;
  /** Remote WebSocket/HTTP endpoint override (RemoteGameTransport). */
  endpoint?: string;
  seed?: number;
  mapId?: string;
};

export type Unsubscribe = () => void;

export type StateListener = (state: GameStateView) => void;

export type EventListener = (event: GameEvent) => void;

/**
 * Generic session resume. Adapters own any opaque token; this type has no SDK fields.
 * `endpoint` is a remote-adapter override and is ignored by a future local transport.
 */
export type ResumeSessionOptions = {
  endpoint?: string;
};

export type ResumeSessionResult =
  { status: "restored" } | { status: "absent" } | { status: "expired" };

/**
 * Transport-level connection notices. These are not gameplay commands and
 * carry no session secret.
 */
export type TransportConnectionNotice = "reconnecting" | "reconnected" | "left" | "expired";

export type ConnectionListener = (notice: TransportConnectionNotice) => void;

/**
 * Client boundary that isolates presentation/UI from the concrete multiplayer SDK.
 * Local and remote implementations share this contract (ADR-006).
 *
 * No Colyseus types appear here — RemoteGameTransport adapts the SDK behind this interface.
 * `resumePreviousSession` restores an existing player context or reports that it cannot.
 * It must not allocate a new room or player identity.
 */
export interface GameTransport {
  connect(options: ConnectOptions): Promise<void>;
  resumePreviousSession(options?: ResumeSessionOptions): Promise<ResumeSessionResult>;
  sendCommand(command: GameCommand): void;
  subscribeState(listener: StateListener): Unsubscribe;
  subscribeEvent(listener: EventListener): Unsubscribe;
  subscribeConnection(listener: ConnectionListener): Unsubscribe;
  /**
   * Session control: asks the host to leave LOBBY and start the match.
   * Not a gameplay {@link GameCommand}; rejection arrives as a `COMMAND_REJECTED` event.
   */
  startMatch(): void;
  /** Room/match id of the live session, `null` when not connected. */
  readonly connectedRoomId: string | null;
  /**
   * True when this transport can try {@link resumePreviousSession}. The opaque
   * token itself is never exposed. Local transport has no resume token.
   */
  hasResumeToken(): boolean;
  /**
   * Latest measured round-trip in milliseconds.
   * `null` means unavailable: no live session yet, or this transport cannot measure RTT.
   * Future LocalGameTransport returns `null`. This is not a Colyseus type and not a wire field.
   */
  readRoundTripMs(): number | null;
  disconnect(): Promise<void>;
}
