/** Colyseus room name for the foundation vertical slice. */
export const FOUNDATION_ROOM_NAME = "foundation" as const;

/** Hard cap from Game Vision / Technical Vision (≤ 4 players). */
export const MAX_PLAYERS = 4;

/**
 * Production reservation after an unexpected disconnect.
 * Client join payloads cannot change this. Tests may assign
 * `FoundationRoom.reconnectGraceSeconds` on the server room only.
 */
export const DEFAULT_RECONNECT_GRACE_SECONDS = 30;

/**
 * Colyseus `maxMessagesPerSecond` for every client (Spec #002 §22.13, TV §35).
 * Exceeding it disconnects the client as an unexpected drop; reconnect grace applies.
 * Normal play sends a few commands per second plus SYNC and RTT pings.
 */
export const MAX_CLIENT_MESSAGES_PER_SECOND = 30;

/** Default HTTP/WebSocket listen port. */
export const DEFAULT_PORT = 2567;

/** Default map when create options omit `mapId`. */
export const DEFAULT_MAP_ID = "foundation";

/** Re-export wire message names from protocol (single source of truth). */
export {
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  START_MESSAGE,
  STATE_MESSAGE,
  SYNC_MESSAGE,
} from "@web-rts/protocol";

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

/** New join after START. Reserved reconnect does not go through onJoin. */
export const MATCH_LOCKED_ERROR_CODE = 4012 as const;
