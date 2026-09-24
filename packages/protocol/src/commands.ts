import { z } from "zod";

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
    commandId: z.string().min(1),
    clientSequence: z.number().int().nonnegative(),
    entityIds: z.array(z.number().int().nonnegative()).min(1),
    target: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  })
  .strict();

export type MoveCommand = z.infer<typeof moveCommandSchema>;

/**
 * Client→server command union for the foundation vertical slice.
 * Extends with new discriminated variants without changing existing MOVE shape.
 */
export const gameCommandSchema = z.discriminatedUnion("type", [moveCommandSchema]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
