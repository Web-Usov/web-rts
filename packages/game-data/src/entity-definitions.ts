/**
 * Static entity definitions (Spec #002 §23.2–23.3). Runtime entities reference
 * them by stable `definitionId`; behaviour lives in simulation.
 */

/** Broad entity category. Concrete units/buildings are definitions, not new kinds. */
export const ENTITY_KINDS = ["UNIT", "BUILDING", "RESOURCE", "OBJECTIVE"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Solid grid footprint size and capabilities (Spec #002 §7.4). Placement is per entity. */
export type FootprintDefinition = {
  readonly width: number;
  readonly height: number;
  readonly blocksMovement: boolean;
  readonly blocksBuilding: boolean;
};

export type EntityDefinition = {
  readonly id: string;
  readonly kind: EntityKind;
  /** `null` for entities that do not occupy grid cells (units in #002). */
  readonly footprint: FootprintDefinition | null;
};

export const ENTITY_DEFINITIONS = {
  /** Primitive controllable Foundation unit until Worker/Soldier definitions land (G5/G6). */
  foundation_unit: { id: "foundation_unit", kind: "UNIT", footprint: null },
  sacred_site: {
    id: "sacred_site",
    kind: "OBJECTIVE",
    footprint: { width: 2, height: 2, blocksMovement: true, blocksBuilding: true },
  },
} as const satisfies Record<string, EntityDefinition>;

export type EntityDefinitionId = keyof typeof ENTITY_DEFINITIONS;

export function getEntityDefinition(definitionId: string): EntityDefinition | undefined {
  return Object.hasOwn(ENTITY_DEFINITIONS, definitionId)
    ? ENTITY_DEFINITIONS[definitionId as EntityDefinitionId]
    : undefined;
}
