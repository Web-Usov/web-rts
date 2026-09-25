import { foundationUnitSpawnPosition } from "@web-rts/game-data";
import type { EntityId, World } from "@web-rts/simulation";

/**
 * Server-side F5 map: playerId → primitive unit entityId.
 * Created only from server-derived player slots; never from client payloads.
 * Designed to be replaced by F6 controller permission checks without changing
 * protocol/simulation command shapes.
 */
export class PrimitiveUnitRegistry {
  private readonly byPlayer = new Map<number, EntityId>();
  private readonly byEntity = new Map<EntityId, number>();

  get size(): number {
    return this.byPlayer.size;
  }

  /** Immutable snapshot for replication projection. */
  snapshot(): ReadonlyMap<number, EntityId> {
    return new Map(this.byPlayer);
  }

  getEntityId(playerId: number): EntityId | undefined {
    return this.byPlayer.get(playerId);
  }

  getPlayerId(entityId: EntityId): number | undefined {
    return this.byEntity.get(entityId);
  }

  /**
   * True when every requested entity is exactly the unit bound to this player.
   * Rejects empty lists and any foreign / unbound entity ids.
   */
  canControlEntities(playerId: number, entityIds: readonly EntityId[]): boolean {
    const bound = this.byPlayer.get(playerId);
    if (bound === undefined || entityIds.length === 0) {
      return false;
    }
    return entityIds.every((entityId) => entityId === bound);
  }

  clear(): void {
    this.byPlayer.clear();
    this.byEntity.clear();
  }

  /**
   * Spawns one movable primitive unit per connected player into the world.
   * Idempotent only when empty — call once at match start.
   */
  spawnForPlayers(world: World, playerIds: readonly number[]): void {
    this.clear();
    for (const playerId of playerIds) {
      const entityId = world.createEntity();
      const spawn = foundationUnitSpawnPosition(playerId);
      world.positions.set(entityId, { x: spawn.x, y: spawn.y });
      this.byPlayer.set(playerId, entityId);
      this.byEntity.set(entityId, playerId);
    }
  }
}
