import type { EntityKind } from "@web-rts/game-data";

export { ENTITY_KINDS, type EntityKind } from "@web-rts/game-data";

/** Compact numeric entity id (uint32-compatible). */
export type EntityId = number;

/** Server-assigned player slot. Not a client-supplied identity. */
export type PlayerId = number;

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned half-open playable area `[minX, maxX) × [minY, maxY)` on simulation (x, y). */
export interface MapBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Broad category + static definition reference (Spec #002 §23.2–23.3).
 * Set once at creation; kind is never inferred from other components.
 */
export interface EntityIdentity {
  readonly kind: EntityKind;
  readonly definitionId: string;
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
 * `null` means unowned (e.g. the Sacred Site).
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

/** Match-level objective id. Independent from the target entity id. */
export type ObjectiveId = number;

/**
 * Generic gameplay role (Technical Vision §18, Spec #002 §21). Concrete entities such
 * as the Sacred Site are identified by `definitionId`, never by objective type.
 */
export const OBJECTIVE_TYPES = ["PROTECT"] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

export const OBJECTIVE_STATES = ["ACTIVE"] as const;
export type ObjectiveState = (typeof OBJECTIVE_STATES)[number];

export interface Objective {
  readonly type: ObjectiveType;
  readonly targetEntityId: EntityId;
  readonly required: boolean;
  state: ObjectiveState;
}
