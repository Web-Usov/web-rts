/**
 * Wire message type names shared by RemoteGameTransport and the game server.
 * Kept as plain strings so Colyseus SDK types do not leak into the protocol package.
 */

/** Client → server gameplay command payload ({@link GameCommand}). */
export const COMMAND_MESSAGE = "command" as const;

/** Client → server request to leave LOBBY and start the match. */
export const START_MESSAGE = "start" as const;

/** Server → client one-shot {@link GameEvent} payloads. */
export const EVENT_MESSAGE = "event" as const;

/** Server → client replicated {@link GameStateView} snapshots. */
export const STATE_MESSAGE = "state" as const;
