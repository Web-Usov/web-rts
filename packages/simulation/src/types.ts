import type { ResourceType, EntityKind } from "@web-rts/game-data";

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
  readonly teamId?: TeamId;
  state: ObjectiveState;
}

export interface PlayerEconomy {
  resources: Record<ResourceType, number>;
}
export interface ResourceNode {
  resourceType: ResourceType;
  remaining: number;
}
export interface Construction {
  state: "UNDER_CONSTRUCTION" | "COMPLETED";
  workedTicks: number;
  readonly durationTicks: number;
}
export interface BuildTask {
  commandId: string;
  playerId: PlayerId;
  constructionEntityId: EntityId;
}

export interface Worker {
  builder: boolean;
  moveSpeed: number;
  carryCapacity: number;
  gatherRate: number;
  carried: { resourceType: ResourceType; amount: number };
}
export interface Dropoff {
  resourceTypes: readonly ResourceType[];
}
export interface GatherTask {
  commandId: string;
  playerId: PlayerId;
  sourceEntityId: EntityId;
  dropoffEntityId: EntityId;
  phase: "TO_SOURCE" | "GATHERING" | "TO_DROPOFF";
  /** Fractional rate accumulator; stock and carry remain integer resource units. */
  gatherProgress: number;
}

/** Allegiance id, independent of player slots and entity ids. */
declare const teamIdBrand: unique symbol;
export type TeamId = string & { readonly [teamIdBrand]: true };

export interface Team {
  readonly teamId: TeamId;
}
export interface Health {
  current: number;
  readonly max: number;
}
export type { AttackProfile, SoldierProfile } from "@web-rts/game-data";
export type SoldierState = "IDLE" | "MOVING" | "ENGAGING";
export interface SoldierTask {
  state: SoldierState;
  targetEntityId: EntityId | null;
  /** Fixed at acquisition; never follows the chased target. */
  anchor: Position | null;
  /** Target cell used to plan the current approach. */
  plannedTargetCell: number | null;
  /** Failed acquisition is retried only when target cell/topology changes. */
  unreachable: Map<EntityId, { cellId: number; revision: number }>;
  /** Prevent immediate reacquisition from incrementally extending a chase. */
  excludedUntilExit: Set<EntityId>;
}
export interface Combat {
  targetEntityId: EntityId | null;
  nextAttackTick: number;
}

/** Sole authoritative slot occupancy, stored on the occupant. */
export interface ContainedIn {
  readonly containerEntityId: EntityId;
  readonly slotIndex: number;
}
export type GarrisonHost = import("@web-rts/game-data").GarrisonHostDefinition;
export interface GarrisonTask {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly containerEntityId: EntityId;
}
