import type { CellCoord } from "@web-rts/game-data";
import type { SpatialGrid } from "./spatial-grid.js";

/** Deterministic work, independent of timing, routes and requested coordinates. */
export interface ComponentWork {
  componentLabelBuilds?: number;
  componentLabelRebuilds?: number;
  componentLabelVisitedCells?: number;
  componentCacheHits?: number;
}

interface ComponentLabels {
  readonly revision: number;
  readonly labels: Uint32Array;
  /** Also serves as the flood-fill queue. Each labelled cell occurs exactly once. */
  readonly members: Uint32Array;
  readonly components: Map<number, Uint32Array>;
  count: number;
}

// Grid identity owns the lifetime. Only one revision is retained per live grid.
const cache = new WeakMap<SpatialGrid, ComponentLabels>();

/** Lazy labelling of the start component. Caller has validated start walkability. */
export function reachableComponent(
  grid: SpatialGrid,
  start: CellCoord,
  work?: ComponentWork,
): { readonly id: number; readonly cells: Uint32Array } {
  let entry = cache.get(grid);
  if (entry?.revision !== grid.topologyRevision) {
    if (entry && work) work.componentLabelRebuilds = (work.componentLabelRebuilds ?? 0) + 1;
    const size = grid.widthCells * grid.heightCells;
    entry = {
      revision: grid.topologyRevision,
      labels: new Uint32Array(size),
      members: new Uint32Array(size),
      components: new Map(),
      count: 0,
    };
    cache.set(grid, entry);
  }
  const startId = grid.cellId(start);
  const known = entry.labels[startId]!;
  if (known !== 0) {
    if (work) work.componentCacheHits = (work.componentCacheHits ?? 0) + 1;
    return { id: known, cells: entry.components.get(known)! };
  }

  // Component identity is internal; row-major projection tie-break uses actual cellIds.
  const id = startId + 1;
  const begin = entry.count;
  entry.labels[startId] = id;
  entry.members[entry.count++] = startId;
  if (work) work.componentLabelBuilds = (work.componentLabelBuilds ?? 0) + 1;
  const next = { x: 0, y: 0 };
  for (let index = begin; index < entry.count; index += 1) {
    const cellId = entry.members[index]!;
    if (work) work.componentLabelVisitedCells = (work.componentLabelVisitedCells ?? 0) + 1;
    const x = cellId % grid.widthCells;
    const y = Math.floor(cellId / grid.widthCells);
    // Same +x, +y, -x, -y connectivity as navigation; this does not choose routes.
    for (let direction = 0; direction < 4; direction += 1) {
      next.x = x + (direction === 0 ? 1 : direction === 2 ? -1 : 0);
      next.y = y + (direction === 1 ? 1 : direction === 3 ? -1 : 0);
      if (!grid.isCellInBounds(next)) continue;
      const nextId = grid.cellId(next);
      if (entry.labels[nextId] !== 0 || !grid.isWalkable(next)) continue;
      entry.labels[nextId] = id;
      entry.members[entry.count++] = nextId;
    }
  }
  const cells = entry.members.subarray(begin, entry.count);
  entry.components.set(id, cells);
  return { id, cells };
}

/** Internal diagnostics only. Stale revision data is never exposed, even before a query. */
export function readComponentCache(grid: SpatialGrid): {
  revision: number;
  labelledComponents: number;
  labelledCells: number;
  retainedArrayBytes: number;
} | null {
  const entry = cache.get(grid);
  if (!entry || entry.revision !== grid.topologyRevision) return null;
  return {
    revision: entry.revision,
    labelledComponents: entry.components.size,
    labelledCells: entry.count,
    retainedArrayBytes: entry.labels.byteLength + entry.members.byteLength,
  };
}
