import { z } from "zod";
import {
  COMMAND_ID_PATTERN,
  MAX_COMMAND_ID_LENGTH,
  MAX_ENTITY_ID,
  MAX_MOVE_ENTITY_IDS,
  MAX_WORLD_COORDINATE_ABS,
} from "./limits.js";

export const commandIdSchema = z
  .string()
  .min(1)
  .max(MAX_COMMAND_ID_LENGTH)
  .regex(COMMAND_ID_PATTERN);

const entityIdSchema = z.int().nonnegative().max(MAX_ENTITY_ID);

const worldCoordinateSchema = z
  .number()
  .min(-MAX_WORLD_COORDINATE_ABS)
  .max(MAX_WORLD_COORDINATE_ABS);

/**
 * Client MOVE intent: target point for controlled entities.
 * Does not carry authoritative world state (positions, HP, resources).
 *
 * Trusted player identity is NOT part of this payload — in multiplayer the
 * server derives identity from the session/connection (Foundation Spec §8).
 */
export const moveCommandSchema = z
  .object({
    type: z.literal("MOVE"),
    commandId: commandIdSchema,
    clientSequence: z.int().nonnegative(),
    entityIds: z.array(entityIdSchema).min(1).max(MAX_MOVE_ENTITY_IDS),
    target: z
      .object({
        x: worldCoordinateSchema,
        y: worldCoordinateSchema,
      })
      .strict(),
  })
  .strict();

export type MoveCommand = z.infer<typeof moveCommandSchema>;

/**
 * Client→server command union for the foundation vertical slice.
 * Extends with new discriminated variants without changing existing MOVE shape.
 */
export const gameCommandSchema = z.discriminatedUnion("type", [moveCommandSchema]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
