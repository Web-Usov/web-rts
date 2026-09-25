/** Compact numeric entity id (uint32-compatible). */
export type EntityId = number;

/** Server-assigned player slot. Not a client-supplied identity. */
export type PlayerId = number;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Position {
  x: number;
  y: number;
}

/** Movement intent: entity travels toward target at speed (units/sec). */
export interface Movement {
  targetX: number;
  targetY: number;
  speed: number;
}

/**
 * Who the entity belongs to. Independent of {@link Controller}.
 * `null` means unowned (objectives in the foundation slice).
 */
export interface Owner {
  ownerPlayerId: PlayerId | null;
}

/**
 * Who may issue commands for the entity right now.
 * Absence of this component means the entity is not controllable.
 */
export interface Controller {
  controllerPlayerId: PlayerId | null;
}

/**
 * Entity-attached objective data (ADR-005).
 * Win/loss catalogs from Technical Vision §18 are out of F6 scope;
 * `type` is an open discriminator so later objectives are additional values,
 * not a Sacred-Site-only world field.
 */
export const OBJECTIVE_TYPES = ["SACRED_SITE"] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

export const OBJECTIVE_STATES = ["ACTIVE"] as const;
export type ObjectiveState = (typeof OBJECTIVE_STATES)[number];

export interface Objective {
  type: ObjectiveType;
  state: ObjectiveState;
}
