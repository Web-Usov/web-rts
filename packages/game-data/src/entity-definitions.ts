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

export const RESOURCE_TYPES = ["WOOD"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const RESOURCE_DEFINITIONS = { WOOD: { id: "WOOD" } } as const;
export type AttackProfile = {
  readonly mode?: "MELEE" | "RANGED";
  readonly damage: number;
  readonly range: number;
  readonly cooldownTicks: number;
  readonly allowedTargets: readonly EntityKind[];
};

export type GarrisonHostDefinition = {
  readonly capacity: number;
  readonly allowedOccupantTags: readonly string[];
  readonly attackProfiles: readonly {
    readonly occupantTag: string;
    readonly profile: AttackProfile;
  }[];
};

export const TOWER_ATTACK_PROFILES = {
  empty: {
    damage: 12,
    range: 7,
    cooldownTicks: 20,
    mode: "RANGED",
    allowedTargets: ["UNIT", "BUILDING", "OBJECTIVE"],
  },
  infantry: {
    damage: 12,
    range: 5,
    cooldownTicks: 8,
    mode: "RANGED",
    allowedTargets: ["UNIT", "BUILDING", "OBJECTIVE"],
  },
} as const satisfies Record<string, AttackProfile>;

export type SoldierProfile = {
  readonly aggroRadius: number;
  readonly chaseRadius: number;
  readonly moveSpeed: number;
};

export type EntityDefinition = {
  readonly tags?: readonly string[];
  readonly garrisonHost?: GarrisonHostDefinition;
  readonly automaticAttack?: boolean;
  readonly worker?: {
    readonly moveSpeed: number;
    readonly carryCapacity: number;
    readonly gatherRate: number;
    readonly builder: boolean;
  };
  readonly resourceNode?: { readonly resourceType: ResourceType; readonly capacity: number };
  readonly dropoff?: { readonly resourceTypes: readonly ResourceType[] };
  readonly id: string;
  readonly kind: EntityKind;
  /** `null` for entities that do not occupy grid cells (units in #002). */
  readonly footprint: FootprintDefinition | null;
  readonly construction?: { readonly woodCost: number; readonly durationTicks: number };
  readonly maxHealth?: number;
  readonly attack?: AttackProfile;
  readonly soldier?: SoldierProfile;
};

export const ENTITY_DEFINITIONS = {
  /** Primitive controllable Foundation unit until Worker/Soldier definitions land (G5/G6). */
  foundation_unit: { id: "foundation_unit", kind: "UNIT", footprint: null },
  worker: {
    id: "worker",
    maxHealth: 60,
    kind: "UNIT",
    footprint: null,
    worker: { moveSpeed: 3, carryCapacity: 10, gatherRate: 5, builder: true },
  },
  wall: {
    id: "wall",
    kind: "BUILDING",
    maxHealth: 200,
    footprint: { width: 1, height: 1, blocksMovement: true, blocksBuilding: true },
    construction: { woodCost: 10, durationTicks: 30 },
  },
  tower: {
    id: "tower",
    kind: "BUILDING",
    maxHealth: 300,
    attack: TOWER_ATTACK_PROFILES.empty,
    automaticAttack: true,
    garrisonHost: {
      capacity: 1,
      allowedOccupantTags: ["infantry"],
      attackProfiles: [{ occupantTag: "infantry", profile: TOWER_ATTACK_PROFILES.infantry }],
    },
    footprint: { width: 1, height: 1, blocksMovement: true, blocksBuilding: true },
    construction: { woodCost: 30, durationTicks: 60 },
  },
  town_hall: {
    id: "town_hall",
    maxHealth: 500,
    kind: "BUILDING",
    footprint: { width: 2, height: 2, blocksMovement: true, blocksBuilding: true },
    dropoff: { resourceTypes: ["WOOD"] },
  },
  wood_node: {
    id: "wood_node",
    kind: "RESOURCE",
    footprint: { width: 1, height: 1, blocksMovement: true, blocksBuilding: true },
    resourceNode: { resourceType: "WOOD", capacity: 100 },
  },
  soldier: {
    id: "soldier",
    tags: ["infantry"],
    kind: "UNIT",
    footprint: null,
    maxHealth: 100,
    attack: {
      damage: 10,
      range: 0.75,
      cooldownTicks: 10,
      allowedTargets: ["UNIT", "BUILDING", "OBJECTIVE"],
    },
    soldier: { aggroRadius: 5, chaseRadius: 8, moveSpeed: 5 },
  },
  sacred_site: {
    id: "sacred_site",
    maxHealth: 1000,
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
