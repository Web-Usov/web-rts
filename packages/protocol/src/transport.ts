import type { GameCommand } from "./commands.js";
import type { GameEvent } from "./events.js";
import type { GameStateView } from "./state.js";

/**
 * Options for establishing a local or remote match session via GameTransport.
 * Concrete remote fields (endpoint, Colyseus room options) are filled by F4/F5 adapters.
 */
export type ConnectOptions = {
  protocolVersion: number;
  gameDataVersion: string;
  roomId?: string;
  createRoom?: boolean;
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
