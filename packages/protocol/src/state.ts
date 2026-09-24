import { z } from "zod";

/**
 * Match lifecycle phases from Foundation Spec §9.
 */
export const matchPhaseSchema = z.enum(["LOBBY", "STARTING", "RUNNING", "FINISHED"]);

export type MatchPhase = z.infer<typeof matchPhaseSchema>;

export const playerSlotViewSchema = z
  .object({
    playerId: z.number().int().nonnegative(),
    connected: z.boolean(),
  })
  .strict();

export type PlayerSlotView = z.infer<typeof playerSlotViewSchema>;

/**
 * Replicated entity projection for clients (not simulation world internals).
 * Ownership/control are view fields; MOVE permission is enforced server-side.
 */
export const entityViewSchema = z
  .object({
    entityId: z.number().int().nonnegative(),
    kind: z.enum(["unit", "objective"]),
    x: z.number().finite(),
    y: z.number().finite(),
    ownerPlayerId: z.number().int().nonnegative().nullable(),
    controllerPlayerId: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type EntityView = z.infer<typeof entityViewSchema>;

/**
 * Network state view DTO delivered through GameTransport.subscribeState.
 * Separated from simulation state (ADR-007).
 */
export const gameStateViewSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    gameDataVersion: z.string().min(1),
    roomId: z.string().min(1),
    tick: z.number().int().nonnegative(),
    phase: matchPhaseSchema,
    players: z.array(playerSlotViewSchema),
    entities: z.array(entityViewSchema),
  })
  .strict();

export type GameStateView = z.infer<typeof gameStateViewSchema>;
