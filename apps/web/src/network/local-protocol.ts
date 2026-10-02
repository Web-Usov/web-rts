import type { GameEvent, GameStateView } from "@web-rts/protocol";

/** Single local skeleton player. Identity is host-assigned, never taken from a command. */
export const LOCAL_PLAYER_ID = 0;

/** Stable room id for the in-browser match. Not a Colyseus room. */
export const LOCAL_ROOM_ID = "local";

/**
 * Main thread → worker messages. This is the local transport bridge, not the
 * gameplay protocol. Command payloads are still validated as GameCommand.
 */
export type MainToWorkerMessage =
  | {
      type: "connect";
      sessionId: number;
      protocolVersion: number;
      gameDataVersion: string;
      seed: number;
      mapId: string;
    }
  | { type: "start"; sessionId: number }
  | { type: "command"; sessionId: number; command: unknown }
  | { type: "disconnect"; sessionId: number };

export type WorkerToMainMessage =
  | { type: "connected"; sessionId: number; roomId: string }
  | { type: "state"; sessionId: number; state: GameStateView }
  | { type: "event"; sessionId: number; event: GameEvent }
  | { type: "failed"; sessionId: number; message: string };
