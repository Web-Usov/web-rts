import { FOUNDATION_MAP, mapWorldBounds, type MapDefinition } from "@web-rts/game-data";

/** Map area on the Babylon ground plane (x, z). Derived, never a separate gameplay size. */
export interface GroundExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Map the client presents. #002 has a single fixed MapDefinition; selecting it by a
 * replicated `mapId` is part of the final GameStateView shape (G11).
 */
export const PRESENTED_MAP: MapDefinition = FOUNDATION_MAP;

/** Simulation (x, y) bounds → Babylon ground (x, z), see coordinates.ts. */
export function mapGroundExtent(map: MapDefinition): GroundExtent {
  const bounds = mapWorldBounds(map);
  return { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minY, maxZ: bounds.maxY };
}
