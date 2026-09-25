import type { GameCommand } from "./commands.js";
import type { GameEvent } from "./events.js";
import type { GameStateView } from "./state.js";

/**
 * Options for establishing a local or remote match session via GameTransport.
 * Concrete remote fields (endpoint, room options) are filled by adapters.
 * Endpoint defaults belong in env/config so Docker/LAN (F9) can override them.
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
 * Client boundary that isolates presentation/UI from the concrete multiplayer SDK.
 * Local and remote implementations share this contract (ADR-006).
 *
 * No Colyseus types appear here — RemoteGameTransport (F4/F5) adapts the SDK behind this interface.
 */
export interface GameTransport {
  connect(options: ConnectOptions): Promise<void>;
  sendCommand(command: GameCommand): void;
  subscribeState(listener: StateListener): Unsubscribe;
  subscribeEvent(listener: EventListener): Unsubscribe;
  disconnect(): Promise<void>;
}
