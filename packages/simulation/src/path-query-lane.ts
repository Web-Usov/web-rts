import type { EntityId } from "./types.js";

/** Internal per-tick policy shared by active tasks and future G9 AI.
 * Call in ascending entityId order. A second query for an entity is deferred;
 * decreasing IDs are programmer errors. Construct a fresh lane every tick.
 * No access to another lane, no refunds, no partial search state.
 */
export class EntityPathQueryLane {
  private lastEntityId: EntityId | undefined;
  private count = 0;

  constructor(private readonly budget: number) {}

  tryReserve(entityId: EntityId): boolean {
    if (this.lastEntityId !== undefined && entityId < this.lastEntityId) {
      throw new RangeError("path requests must be in ascending entityId order");
    }
    if (entityId === this.lastEntityId) return false;
    this.lastEntityId = entityId;
    if (this.count >= this.budget) return false;
    this.count += 1;
    return true;
  }

  get used(): number {
    return this.count;
  }
}
