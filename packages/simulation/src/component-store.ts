import type { EntityId } from "./types.js";

/** Sparse component store keyed by entity id. */
export class ComponentStore<T> {
  private readonly values = new Map<EntityId, T>();

  set(entityId: EntityId, value: T): void {
    this.values.set(entityId, value);
  }

  get(entityId: EntityId): T | undefined {
    return this.values.get(entityId);
  }

  has(entityId: EntityId): boolean {
    return this.values.has(entityId);
  }

  remove(entityId: EntityId): boolean {
    return this.values.delete(entityId);
  }

  clear(): void {
    this.values.clear();
  }

  entries(): IterableIterator<[EntityId, T]> {
    return this.values.entries();
  }
}
