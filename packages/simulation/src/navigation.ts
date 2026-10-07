import type { CellCoord } from "@web-rts/game-data";
import type { SpatialFootprint, SpatialGrid } from "./spatial-grid.js";
import type { Vec2 } from "./types.js";

/**
 * Deterministic 4-neighbor navigation (Spec #002 §8.1–8.6, ADR-008).
 * Path state stays inside the simulation; it is not replicated.
 */

/** Fixed neighbour order: +x, +y, -x, -y. Not a search tie-break. */
export const NEIGHBOR_OFFSETS: readonly CellCoord[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** Grid surface the path query reads. `SpatialGrid` satisfies it. */
export interface WalkGrid {
  readonly widthCells: number;
  readonly heightCells: number;
  isCellInBounds(cell: CellCoord): boolean;
  isWalkable(cell: CellCoord): boolean;
  cellId(cell: CellCoord): number;
}

/**
 * Simulation-internal route from a MOVE. The last waypoint is the exact
 * world-space destination; earlier waypoints are smoothed canonical cell centers.
 */
export interface NavigationTask {
  readonly destinationX: number;
  readonly destinationY: number;
  readonly pathCells: readonly CellCoord[];
  readonly waypoints: readonly Vec2[];
  readonly waypointIndex: number;
  /** `topologyRevision` captured when this path was planned. */
  readonly plannedRevision: number;
  /** Revision against which the active execution segment was validated. */
  readonly validatedRevision: number;
}

interface OpenNode {
  readonly f: number;
  readonly h: number;
  readonly cellId: number;
  readonly g: number;
}

/**
 * One-cell approach ring around a rectangular footprint, stable row-major order.
 * Drops out-of-bounds and non-walkable cells. Does not know entity kinds.
 */
export function approachGoalCells(
  grid: WalkGrid,
  footprint: Pick<SpatialFootprint, "anchorCell" | "width" | "height">,
): CellCoord[] {
  const { anchorCell, width, height } = footprint;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(anchorCell.x) ||
    !Number.isInteger(anchorCell.y)
  ) {
    return [];
  }

  const cells: CellCoord[] = [];
  const minY = anchorCell.y - 1;
  const maxY = anchorCell.y + height;
  const minX = anchorCell.x - 1;
  const maxX = anchorCell.x + width;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const inside =
        x >= anchorCell.x &&
        x < anchorCell.x + width &&
        y >= anchorCell.y &&
        y < anchorCell.y + height;
      if (inside) {
        continue;
      }
      const cell = { x, y };
      if (!grid.isCellInBounds(cell) || !grid.isWalkable(cell)) {
        continue;
      }
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * Deterministic multi-goal A*.
 * Uniform edge cost 1, Manhattan heuristic (minimum over goals),
 * open-set order `f → h → cellId`. Returns the cell path including `start`,
 * or `null` when no goal is reachable.
 */
export function findPath(
  grid: WalkGrid,
  start: CellCoord,
  goals: readonly CellCoord[],
): CellCoord[] | null {
  if (!grid.isCellInBounds(start) || !grid.isWalkable(start)) {
    return null;
  }

  const goalIds = new Set<number>();
  const openGoals: CellCoord[] = [];
  for (const goal of goals) {
    if (!grid.isCellInBounds(goal) || !grid.isWalkable(goal)) {
      continue;
    }
    const id = grid.cellId(goal);
    if (goalIds.has(id)) {
      continue;
    }
    goalIds.add(id);
    openGoals.push(goal);
  }
  if (openGoals.length === 0) {
    return null;
  }

  const startId = grid.cellId(start);
  if (goalIds.has(startId)) {
    return [{ x: start.x, y: start.y }];
  }

  const cellCount = grid.widthCells * grid.heightCells;
  const gScore = new Int32Array(cellCount).fill(-1);
  const cameFrom = new Int32Array(cellCount).fill(-1);
  const expanded = new Uint8Array(cellCount);
  gScore[startId] = 0;

  const startHeuristic = heuristic(start.x, start.y, openGoals);
  const open = new BinaryHeap<OpenNode>(openComesBefore);
  open.push({ f: startHeuristic, h: startHeuristic, cellId: startId, g: 0 });

  const width = grid.widthCells;
  while (open.size > 0) {
    const current = open.pop();
    if (current === undefined) {
      break;
    }
    if (current.g !== gScore[current.cellId]) {
      continue;
    }
    if (expanded[current.cellId] === 1) {
      continue;
    }
    expanded[current.cellId] = 1;
    if (goalIds.has(current.cellId)) {
      const path = reconstruct(cameFrom, current.cellId, startId, width);
      return path.length === 0 ? null : path;
    }

    const cx = current.cellId % width;
    const cy = Math.floor(current.cellId / width);
    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: cx + offset.x, y: cy + offset.y };
      if (!grid.isCellInBounds(next) || !grid.isWalkable(next)) {
        continue;
      }
      const nextId = grid.cellId(next);
      if (expanded[nextId] === 1) {
        continue;
      }
      const newG = current.g + 1;
      const known = gScore[nextId] ?? -1;
      if (known !== -1 && newG >= known) {
        continue;
      }
      gScore[nextId] = newG;
      cameFrom[nextId] = current.cellId;
      const h = heuristic(next.x, next.y, openGoals);
      open.push({ f: newG + h, h, cellId: nextId, g: newG });
    }
  }

  return null;
}

/** Resolve only blocked endpoints; a valid but unreachable exact target stays no_path. */
export function planMoveToTarget(
  grid: SpatialGrid,
  origin: Vec2,
  requested: Vec2,
): NavigationTask | null {
  if (!grid.containsWorldPoint(requested)) return null;
  if (segmentIsTraversable(grid, requested, requested)) {
    return planMove(grid, origin, requested);
  }
  const start = grid.worldToCell(origin);
  if (!grid.isCellInBounds(start) || !grid.isWalkable(start)) return null;

  const visited = new Uint8Array(grid.widthCells * grid.heightCells);
  const queue: CellCoord[] = [start];
  visited[grid.cellId(start)] = 1;
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  let bestId = Infinity;
  // Numerical clearance for endpoint edge/corner checks; not a unit radius.
  const inset = 0.0001;
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index]!;
    const center = grid.cellToWorldCenter(cell);
    const point = {
      x: Math.max(center.x - 0.5 + inset, Math.min(center.x + 0.5 - inset, requested.x)),
      y: Math.max(center.y - 0.5 + inset, Math.min(center.y + 0.5 - inset, requested.y)),
    };
    const distance = (point.x - requested.x) ** 2 + (point.y - requested.y) ** 2;
    const id = grid.cellId(cell);
    if (distance < bestDistance || (distance === bestDistance && id < bestId)) {
      best = point;
      bestDistance = distance;
      bestId = id;
    }
    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: cell.x + offset.x, y: cell.y + offset.y };
      if (!grid.isCellInBounds(next) || !grid.isWalkable(next)) continue;
      const nextId = grid.cellId(next);
      if (visited[nextId] === 1) continue;
      visited[nextId] = 1;
      queue.push(next);
    }
  }
  return best === null ? null : planMove(grid, origin, best);
}

/** Plans a MOVE from a world position to an exact world destination. */
export function planMove(
  grid: SpatialGrid,
  origin: Vec2,
  destination: Vec2,
): NavigationTask | null {
  const pathCells = findPath(grid, grid.worldToCell(origin), [grid.worldToCell(destination)]);
  if (pathCells === null) {
    return null;
  }
  const waypoints = smoothPath(grid, origin, waypointsForPath(grid, pathCells, destination));
  if (waypoints === null) {
    return null;
  }
  return {
    destinationX: destination.x,
    destinationY: destination.y,
    pathCells,
    waypoints,
    waypointIndex: 0,
    plannedRevision: grid.topologyRevision,
    validatedRevision: grid.topologyRevision,
  };
}

/** Validates the active segment lazily. This function never changes Position. */
export function prepareNavigation(
  grid: SpatialGrid,
  task: NavigationTask,
  position: Vec2,
): NavigationTask | null {
  const waypoint = task.waypoints[task.waypointIndex];
  if (waypoint === undefined) {
    return null;
  }
  if (task.validatedRevision === grid.topologyRevision) {
    return task;
  }
  if (segmentIsTraversable(grid, position, waypoint)) {
    return { ...task, validatedRevision: grid.topologyRevision };
  }
  return planMove(grid, position, { x: task.destinationX, y: task.destinationY });
}

/** Farthest-visible string pulling, with a stable descending candidate order. */
function smoothPath(grid: SpatialGrid, origin: Vec2, canonical: readonly Vec2[]): Vec2[] | null {
  const result: Vec2[] = [];
  let current = origin;
  let next = 0;
  while (next < canonical.length) {
    let selected = -1;
    for (let index = canonical.length - 1; index >= next; index -= 1) {
      const candidate = canonical[index]!;
      if (segmentIsTraversable(grid, current, candidate)) {
        selected = index;
        break;
      }
    }
    if (selected < 0) {
      return null;
    }
    current = canonical[selected]!;
    result.push(current);
    next = selected + 1;
  }
  return result;
}

/**
 * Conservative supercover equivalent: split at every grid-line crossing, inspect
 * crossings and interval midpoints. Edge touches check both sides; corner touches
 * check all four cells. The closed segment includes both endpoints. Only cells
 * inside the map count at its outer edge (endpoints must still be in bounds).
 * Near-boundary floating point values are conservatively treated as touching.
 */
export function segmentIsTraversable(grid: SpatialGrid, from: Vec2, to: Vec2): boolean {
  if (!grid.containsWorldPoint(from) || !grid.containsWorldPoint(to)) {
    return false;
  }
  // ADR-008: one navigation cell = one world unit.
  const ax = from.x - grid.originX;
  const ay = from.y - grid.originY;
  const bx = to.x - grid.originX;
  const by = to.y - grid.originY;
  const times = [0, 1];
  for (const [start, end] of [
    [ax, bx],
    [ay, by],
  ] as const) {
    if (start === end) continue;
    for (
      let line = Math.ceil(Math.min(start, end));
      line <= Math.floor(Math.max(start, end));
      line += 1
    ) {
      const t = (line - start) / (end - start);
      if (t > 0 && t < 1) times.push(t);
    }
  }
  times.sort((a, b) => a - b);
  const touchedAxis = (value: number): readonly number[] => {
    const rounded = Math.round(value);
    return Math.abs(value - rounded) <= 1e-10 ? [rounded - 1, rounded] : [Math.floor(value)];
  };
  const clearAt = (t: number): boolean => {
    for (const y of touchedAxis(ay + (by - ay) * t)) {
      for (const x of touchedAxis(ax + (bx - ax) * t)) {
        const cell = { x, y };
        if (grid.isCellInBounds(cell) && !grid.isWalkable(cell)) return false;
      }
    }
    return true;
  };
  for (let index = 0; index < times.length; index += 1) {
    const t = times[index]!;
    if (!clearAt(t)) return false;
    const next = times[index + 1];
    if (next !== undefined && !clearAt((t + next) / 2)) return false;
  }
  return true;
}

function waypointsForPath(
  grid: SpatialGrid,
  pathCells: readonly CellCoord[],
  destination: Vec2,
): Vec2[] {
  const waypoints: Vec2[] = [];
  for (let index = 0; index < pathCells.length; index += 1) {
    const cell = pathCells[index];
    if (cell !== undefined) {
      waypoints.push(grid.cellToWorldCenter(cell));
    }
  }
  waypoints.push({ x: destination.x, y: destination.y });
  return waypoints;
}

function heuristic(x: number, y: number, goals: readonly CellCoord[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    const distance = Math.abs(x - goal.x) + Math.abs(y - goal.y);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

function reconstruct(
  cameFrom: Int32Array,
  goalId: number,
  startId: number,
  width: number,
): CellCoord[] {
  const cells: CellCoord[] = [];
  let id = goalId;
  while (id !== startId) {
    cells.push(cellFromId(id, width));
    const previous = cameFrom[id] ?? -1;
    if (previous < 0) {
      return [];
    }
    id = previous;
  }
  cells.push(cellFromId(startId, width));
  cells.reverse();
  return cells;
}

function cellFromId(cellId: number, width: number): CellCoord {
  const x = cellId % width;
  return { x, y: Math.floor(cellId / width) };
}

function openComesBefore(left: OpenNode, right: OpenNode): boolean {
  if (left.f !== right.f) {
    return left.f < right.f;
  }
  if (left.h !== right.h) {
    return left.h < right.h;
  }
  return left.cellId < right.cellId;
}

/** Binary heap ordered only by {@link openComesBefore}. Insertion order is not a key. */
class BinaryHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly comesBefore: (left: T, right: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) {
      return undefined;
    }
    const root = items[0];
    const last = items.pop();
    if (last === undefined || root === undefined) {
      return undefined;
    }
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return root;
  }

  private siftUp(index: number): void {
    const items = this.items;
    const item = items[index];
    if (item === undefined) {
      return;
    }
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentItem = items[parent];
      if (parentItem === undefined || !this.comesBefore(item, parentItem)) {
        break;
      }
      items[index] = parentItem;
      index = parent;
    }
    items[index] = item;
  }

  private siftDown(index: number): void {
    const items = this.items;
    const item = items[index];
    if (item === undefined) {
      return;
    }
    const length = items.length;
    while (true) {
      const left = index * 2 + 1;
      if (left >= length) {
        break;
      }
      const right = left + 1;
      let best = left;
      const leftItem = items[left];
      const rightItem = items[right];
      if (
        right < length &&
        leftItem !== undefined &&
        rightItem !== undefined &&
        this.comesBefore(rightItem, leftItem)
      ) {
        best = right;
      }
      const bestItem = items[best];
      if (bestItem === undefined || !this.comesBefore(bestItem, item)) {
        break;
      }
      items[index] = bestItem;
      index = best;
    }
    items[index] = item;
  }
}
