/**
 * Ingress bounds for client-controlled command fields (Spec #002 §22.9, §22.13).
 * Schemas enforce them, so an oversized payload is a normal `invalid_schema`
 * rejection and never reaches the shared runtime.
 */

/** Max `commandId` length in Unicode code points. */
export const MAX_COMMAND_ID_LENGTH = 64;

/** `commandId` domain: visible ASCII, no whitespace or control characters. */
export const COMMAND_ID_PATTERN = /^[\x21-\x7E]+$/;

/**
 * Max `MOVE.entityIds[]` length. Spec #002 §8.8 charges a MOVE `entityIds.length`
 * path queries, and G4b must keep `MAX_MOVE_ENTITY_IDS <= commandBudget`.
 */
export const MAX_MOVE_ENTITY_IDS = 16;

/** Upper bound of a wire entity id. Entity ids are non-negative integers. */
export const MAX_ENTITY_ID = 0x7fff_ffff;

/**
 * Absolute bound of a world-space coordinate on the wire. Map bounds stay a
 * gameplay rule (`out_of_bounds` at the tick boundary); this only keeps the
 * numeric domain finite and small.
 */
export const MAX_WORLD_COORDINATE_ABS = 100_000;
