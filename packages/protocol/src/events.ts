import { z } from "zod";

/**
 * One-shot server→client notifications (not persistent replicated state).
 * @see docs/technical-vision.md §13, ADR-007
 */
export const commandRejectedEventSchema = z
  .object({
    type: z.literal("COMMAND_REJECTED"),
    commandId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export const protocolMismatchEventSchema = z
  .object({
    type: z.literal("PROTOCOL_MISMATCH"),
    expectedProtocolVersion: z.number().int().positive(),
    actualProtocolVersion: z.number().int().nonnegative(),
    expectedGameDataVersion: z.string().min(1),
    actualGameDataVersion: z.string().min(1),
  })
  .strict();

export const gameEventSchema = z.discriminatedUnion("type", [
  commandRejectedEventSchema,
  protocolMismatchEventSchema,
]);

export type CommandRejectedEvent = z.infer<typeof commandRejectedEventSchema>;
export type ProtocolMismatchEvent = z.infer<typeof protocolMismatchEventSchema>;
export type GameEvent = z.infer<typeof gameEventSchema>;
