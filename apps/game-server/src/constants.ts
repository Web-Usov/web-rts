/** Colyseus room name for the foundation vertical slice. */
export const FOUNDATION_ROOM_NAME = "foundation" as const;

/** Hard cap from Game Vision / Technical Vision (≤ 4 players). */
export const MAX_PLAYERS = 4;

/** Default HTTP/WebSocket listen port. */
export const DEFAULT_PORT = 2567;

/** Default map when create options omit `mapId`. */
export const DEFAULT_MAP_ID = "foundation";

/** Client→server message type for gameplay commands. */
export const COMMAND_MESSAGE = "command" as const;

/** Client→server message type to leave LOBBY and start simulation. */
export const START_MESSAGE = "start" as const;

/** Server→client message type for one-shot GameEvent payloads. */
export const EVENT_MESSAGE = "event" as const;

/**
 * Auth/matchmaking errors use HTTP-style codes (Colyseus docs for onAuth).
 * Do NOT use framework-reserved WS close codes 4000–4010 here.
 */
export const AUTH_ERROR_CODE = 400 as const;

/**
 * Application WebSocket/close codes start at 4011 (Colyseus reserves 4000–4010).
 * 4010 is MAY_TRY_RECONNECT — never use it for protocol mismatch.
 */
export const ROOM_FULL_ERROR_CODE = 4011 as const;
