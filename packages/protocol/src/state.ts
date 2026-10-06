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

/** Broad entity category (Spec #002 §23.3). Concrete types travel as `definitionId`. */
export const entityKindSchema = z.enum(["UNIT", "BUILDING", "RESOURCE", "OBJECTIVE"]);

export type EntityKindView = z.infer<typeof entityKindSchema>;

/** Generic objective role (Technical Vision §18); not a concrete entity identity. */
export const objectiveTypeSchema = z.enum(["PROTECT"]);

/**
 * Replicated entity projection for clients (not simulation world internals).
 * Ownership/control are view fields; MOVE permission is enforced server-side.
 */
export const entityViewSchema = z
  .object({
    entityId: z.number().int().nonnegative(),
    kind: entityKindSchema,
    /** Stable game-data definition id, e.g. `sacred_site`. */
    definitionId: z.string().min(1).max(64),
    x: z.number().finite(),
    y: z.number().finite(),
    ownerPlayerId: z.number().int().nonnegative().nullable(),
    controllerPlayerId: z.number().int().nonnegative().nullable(),
    /** Objective role targeting this entity; null when it has none. */
    objectiveType: objectiveTypeSchema.nullable(),
    objectiveState: z.enum(["ACTIVE"]).nullable(),
  })
  .strict();

export type EntityView = z.infer<typeof entityViewSchema>;

/**
 * Network state view DTO delivered through GameTransport.subscribeState.
 * Separated from simulation state (ADR-007).
 *
 * `localPlayerId` is filled per recipient by the server/application projection so
 * the client can bind UI/selection to its session without trusting client-supplied
 * identity or guessing from entity array order. Future LocalGameTransport can set
 * the same field. This is not the F6 Owner/Controller permission model.
 */
export const gameStateViewSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    gameDataVersion: z.string().min(1),
    roomId: z.string().min(1),
    tick: z.number().int().nonnegative(),
    phase: matchPhaseSchema,
    localPlayerId: z.number().int().nonnegative(),
    players: z.array(playerSlotViewSchema),
    entities: z.array(entityViewSchema),
  })
  .strict();

export type GameStateView = z.infer<typeof gameStateViewSchema>;
