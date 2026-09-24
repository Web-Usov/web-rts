/** Plain presentation data. This is not simulation state and not a network contract. */

export type PresentationKind = "unit" | "objective";

export interface PresentationVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PresentationEntity {
  readonly id: number;
  readonly kind: PresentationKind;
  readonly position: PresentationVec3;
  readonly colorSlot: number;
}

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/** Data a future client state adapter can push into the scene. */
export interface PresentationSyncData {
  readonly entities: readonly PresentationEntity[];
  readonly selectedIds: readonly number[];
  readonly destination: GroundPoint | null;
}

/** Discrete HUD snapshot. Intentionally has no per-entity transforms. */
export interface HudView {
  readonly entityCount: number;
  readonly selectedIds: readonly number[];
  readonly hasDestination: boolean;
}

export interface PresentationDiff {
  readonly upserted: readonly PresentationEntity[];
  readonly removedIds: readonly number[];
}
