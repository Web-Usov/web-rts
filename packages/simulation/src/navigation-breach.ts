import type { CellCoord } from "@web-rts/game-data";
import { NEIGHBOR_OFFSETS, type WalkGrid } from "./navigation.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type { EntityId } from "./types.js";

/** Read-only topology surface; SpatialGrid satisfies it without an adapter. */
export interface BreachGrid extends WalkGrid {
  isStaticWalkable: SpatialGrid["isStaticWalkable"];
  occupantAt: SpatialGrid["occupantAt"];
  footprintOf: SpatialGrid["footprintOf"];
}

export type BreachPathResult =
  | {
      readonly status: "found";
      /** Planning-only cell route, including start and goal. Never a MOVE path. */
      readonly pathCells: readonly CellCoord[];
      readonly breachCount: number;
      /** Number of 4-neighbor edges: pathCells.length - 1. */
      readonly pathLength: number;
      readonly firstBlockerEntityId: EntityId | null;
    }
  | { readonly status: "no_route" };

interface SearchState {
  active: boolean;
  readonly cellId: number;
  /** Canonical ascending numeric IDs, independent of footprint encounter order. */
  readonly breached: readonly EntityId[];
  readonly g: number;
  readonly h: number;
  readonly previous: SearchState | null;
  readonly firstBlockerEntityId: EntityId | null;
}

/**
 * Pure multi-goal breach query (Spec #002 §8.7, ADR-008).
 * Caller supplies a stable, pure hostility/capability predicate for this query.
 * Start and goals must be normally walkable; only intermediate movement-blocking
 * footprints may be virtually crossed. Static terrain is never traversable.
 *
 * A* states are (cellId, canonical breached set), not just cells or breach counts.
 * Priority is breachCount → g + Manhattan → Manhattan → cellId → breached IDs.
 * The remaining-breach lower bound is zero. Thus the first goal minimizes unique
 * breached entities, then edge length. Equal state costs keep the first parent
 * discovered by the explicit priority and fixed neighbor order.
 *
 * Per-cell labels prune only subset-dominated states with no longer prefix.
 * No search cap or hidden normal A*. Worst-case state space is O(cells * 2^B)
 * for B breachable entities; this synchronous query does not schedule gameplay.
 */
export function findBreachPath(
  grid: BreachGrid,
  start: CellCoord,
  goals: readonly CellCoord[],
  isHostileBreachable: (entityId: EntityId) => boolean,
): BreachPathResult {
  if (!grid.isCellInBounds(start) || !grid.isWalkable(start)) {
    return { status: "no_route" };
  }
  const goalIds = new Set<number>();
  const validGoals: CellCoord[] = [];
  for (const goal of goals) {
    if (!grid.isCellInBounds(goal) || !grid.isWalkable(goal)) continue;
    const id = grid.cellId(goal);
    if (goalIds.has(id)) continue;
    goalIds.add(id);
    validGoals.push(goal);
  }
  if (validGoals.length === 0) return { status: "no_route" };

  const heuristic = (cell: CellCoord): number => {
    let best = Infinity;
    for (const goal of validGoals) {
      best = Math.min(best, Math.abs(cell.x - goal.x) + Math.abs(cell.y - goal.y));
    }
    return best;
  };
  const startId = grid.cellId(start);
  const initial: SearchState = {
    active: true,
    cellId: startId,
    breached: [],
    g: 0,
    h: heuristic(start),
    previous: null,
    firstBlockerEntityId: null,
  };
  const labelsByCell: SearchState[][] = new Array(grid.widthCells * grid.heightCells);
  labelsByCell[startId] = [initial];
  const classification = new Map<EntityId, boolean>();
  const open = new StateHeap();
  open.push(initial);

  while (open.size > 0) {
    const current = open.pop()!;
    if (!current.active) continue;
    if (goalIds.has(current.cellId)) {
      const pathCells: CellCoord[] = [];
      for (let state: SearchState | null = current; state !== null; state = state.previous) {
        pathCells.push(cellFromId(state.cellId, grid.widthCells));
      }
      pathCells.reverse();
      return {
        status: "found",
        pathCells,
        breachCount: current.breached.length,
        pathLength: current.g,
        firstBlockerEntityId: current.firstBlockerEntityId,
      };
    }

    const cell = cellFromId(current.cellId, grid.widthCells);
    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: cell.x + offset.x, y: cell.y + offset.y };
      if (!grid.isCellInBounds(next) || !grid.isStaticWalkable(next)) continue;
      let blocker: EntityId | null = null;
      if (!grid.isWalkable(next)) {
        const occupant = grid.occupantAt(next);
        if (occupant === null || grid.footprintOf(occupant)?.blocksMovement !== true) continue;
        let allowed = classification.get(occupant);
        if (allowed === undefined) {
          allowed = isHostileBreachable(occupant);
          classification.set(occupant, allowed);
        }
        if (!allowed) continue;
        blocker = occupant;
      }
      const breached = blocker === null ? current.breached : addBreach(current.breached, blocker);
      const nextId = grid.cellId(next);
      const g = current.g + 1;
      const labels = labelsByCell[nextId] ?? (labelsByCell[nextId] = []);
      // For any suffix S: A ⊆ B implies A ∪ S ⊆ B ∪ S. With gA <= gB,
      // A cannot lose on either objective. Cardinality alone is insufficient.
      // Keep the first equal label; removed heap entries are skipped via active.
      const dominated = labels.some((label) => label.g <= g && isSubset(label.breached, breached));
      if (dominated) continue;
      for (let index = labels.length - 1; index >= 0; index -= 1) {
        const label = labels[index]!;
        if (g <= label.g && isSubset(breached, label.breached)) {
          label.active = false;
          labels.splice(index, 1);
        }
      }
      const state: SearchState = {
        active: true,
        cellId: nextId,
        breached,
        g,
        h: heuristic(next),
        previous: current,
        firstBlockerEntityId: current.firstBlockerEntityId ?? blocker,
      };
      labels.push(state);
      open.push(state);
    }
  }
  return { status: "no_route" };
}

/** Insert once in numeric order without sorting or serializing the whole set. */
function addBreach(breached: readonly EntityId[], id: EntityId): readonly EntityId[] {
  let index = 0;
  while (index < breached.length && breached[index]! < id) index += 1;
  if (breached[index] === id) return breached;
  const next = [...breached];
  next.splice(index, 0, id);
  return next;
}

/** Sorted unique sets; the caller must also compare prefix lengths. */
function isSubset(a: readonly EntityId[], b: readonly EntityId[]): boolean {
  if (a === b || a.length === 0) return true;
  if (a.length > b.length) return false;
  let index = 0;
  for (const id of b) {
    if (id === a[index]) {
      index += 1;
      if (index === a.length) return true;
    } else if (index < a.length && id > a[index]!) return false;
  }
  return false;
}

function cellFromId(id: number, width: number): CellCoord {
  return { x: id % width, y: Math.floor(id / width) };
}

function comesBefore(a: SearchState, b: SearchState): boolean {
  if (a.breached.length !== b.breached.length) return a.breached.length < b.breached.length;
  if (a.g + a.h !== b.g + b.h) return a.g + a.h < b.g + b.h;
  if (a.h !== b.h) return a.h < b.h;
  if (a.cellId !== b.cellId) return a.cellId < b.cellId;
  for (let index = 0; index < a.breached.length; index += 1) {
    if (a.breached[index] !== b.breached[index]) return a.breached[index]! < b.breached[index]!;
  }
  return false;
}

/** Query-local binary heap. Neither Map/Set nor insertion order is a priority key. */
class StateHeap {
  private readonly items: SearchState[] = [];

  get size(): number {
    return this.items.length;
  }

  push(state: SearchState): void {
    let index = this.items.length;
    this.items.push(state);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!comesBefore(state, this.items[parent]!)) break;
      this.items[index] = this.items[parent]!;
      index = parent;
    }
    this.items[index] = state;
  }

  pop(): SearchState | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (last === undefined || this.items.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.items.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const best =
        right < this.items.length && comesBefore(this.items[right]!, this.items[left]!)
          ? right
          : left;
      if (!comesBefore(this.items[best]!, last)) break;
      this.items[index] = this.items[best]!;
      index = best;
    }
    this.items[index] = last;
    return first;
  }
}
