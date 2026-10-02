import { spawnFoundationUnits } from "@web-rts/game-data";
import type { EntityId, World } from "@web-rts/simulation";

/**
 * Technical index: server-derived playerId → primitive unit entityId.
 * Used by bootstrap and tests to find a player's unit.
 * Gameplay MOVE permission reads World Controller, not this registry.
 */
export class PrimitiveUnitRegistry {
  private readonly byPlayer = new Map<number, EntityId>();

  get size(): number {
    return this.byPlayer.size;
  }

  getEntityId(playerId: number): EntityId | undefined {
    return this.byPlayer.get(playerId);
  }

  clear(): void {
    this.byPlayer.clear();
  }

  /**
   * Spawns one movable primitive unit per connected player into the world.
   * Idempotent only when empty — call once at match start.
   */
  spawnForPlayers(world: World, playerIds: readonly number[]): void {
    this.clear();
    for (const [playerId, entityId] of spawnFoundationUnits(world, playerIds)) {
      this.byPlayer.set(playerId, entityId);
    }
  }
}
