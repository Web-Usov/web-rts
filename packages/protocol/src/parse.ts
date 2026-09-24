import type { z } from "zod";
import { gameCommandSchema, type GameCommand } from "./commands.js";
import { gameEventSchema, type GameEvent } from "./events.js";
import { gameStateViewSchema, type GameStateView } from "./state.js";

export type ProtocolParseSuccess<T> = {
  success: true;
  data: T;
};

export type ProtocolParseFailure = {
  success: false;
  error: {
    issues: ReadonlyArray<{
      path: ReadonlyArray<PropertyKey>;
      message: string;
      code: string;
    }>;
  };
};

export type ProtocolParseResult<T> = ProtocolParseSuccess<T> | ProtocolParseFailure;

function toProtocolResult<T>(result: z.ZodSafeParseResult<T>): ProtocolParseResult<T> {
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: {
      issues: result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    },
  };
}

/**
 * Runtime-validates an unknown client command payload without throwing.
 * Malformed input returns `{ success: false }` so rooms/processes stay up.
 */
export function parseGameCommand(input: unknown): ProtocolParseResult<GameCommand> {
  return toProtocolResult(gameCommandSchema.safeParse(input));
}

export function parseGameEvent(input: unknown): ProtocolParseResult<GameEvent> {
  return toProtocolResult(gameEventSchema.safeParse(input));
}

export function parseGameStateView(input: unknown): ProtocolParseResult<GameStateView> {
  return toProtocolResult(gameStateViewSchema.safeParse(input));
}
