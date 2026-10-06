import type { CellCoord } from "@web-rts/game-data";
import type { ComponentStore } from "./component-store.js";
import type { SpatialFootprint, SpatialGrid } from "./spatial-grid.js";
import type { Movement, Position, Vec2 } from "./types.js";

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

const ARRIVAL_EPSILON = 1e-6;

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
 * world-space destination; earlier waypoints are intermediate cell centers.
 */
export interface NavigationTask {
  readonly destinationX: number;
  readonly destinationY: number;
  readonly pathCells: readonly CellCoord[];
  readonly waypoints: readonly Vec2[];
  readonly waypointIndex: number;
  /** `topologyRevision` captured when this path was planned. */
  readonly plannedRevision: number;
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
  return {
    destinationX: destination.x,
    destinationY: destination.y,
    pathCells,
    waypoints: waypointsForPath(grid, pathCells, destination),
    waypointIndex: 0,
    plannedRevision: grid.topologyRevision,
  };
}

export interface NavigationStep {
  readonly position: Position;
  /** `null` when the route finished or a replan could not avoid a blocked cell. */
  readonly task: NavigationTask | null;
}

/**
 * Follows waypoints for one tick, spending the full distance budget across
 * cell centers. Before entering the next path cell, a non-walkable cell
 * triggers one normal replan toward the original world destination.
 * A failed replan stops short of that cell. Later `ACTION_FAILED` is G11.
 */
export function followNavigation(
  grid: SpatialGrid,
  task: NavigationTask,
  position: Position,
  budget: number,
): NavigationStep {
  let pathCells = task.pathCells;
  let waypoints = task.waypoints;
  let waypointIndex = task.waypointIndex;
  let plannedRevision = task.plannedRevision;
  let current: Position = { x: position.x, y: position.y };
  let remaining = budget;

  while (remaining > ARRIVAL_EPSILON && waypointIndex < waypoints.length) {
    const enter = pathCells[waypointIndex + 1];
    if (
      enter !== undefined &&
      !sameCell(grid.worldToCell(current), enter) &&
      !grid.isWalkable(enter)
    ) {
      const replanned = planMove(grid, current, {
        x: task.destinationX,
        y: task.destinationY,
      });
      const retryEnter = replanned?.pathCells[replanned.waypointIndex + 1];
      if (replanned === null || (retryEnter !== undefined && !grid.isWalkable(retryEnter))) {
        return { position: current, task: null };
      }
      pathCells = replanned.pathCells;
      waypoints = replanned.waypoints;
      waypointIndex = replanned.waypointIndex;
      plannedRevision = replanned.plannedRevision;
      continue;
    }

    const waypoint = waypoints[waypointIndex];
    if (waypoint === undefined) {
      break;
    }
    const step = advanceToward(current, waypoint.x, waypoint.y, remaining);
    current = { x: step.x, y: step.y };
    remaining = step.remaining;
    if (!step.arrived) {
      break;
    }
    waypointIndex += 1;
  }

  if (waypointIndex >= waypoints.length) {
    return { position: current, task: null };
  }
  return {
    position: current,
    task: {
      destinationX: task.destinationX,
      destinationY: task.destinationY,
      pathCells,
      waypoints,
      waypointIndex,
      plannedRevision,
    },
  };
}

/** Applies active navigation tasks. Straight-line Movement is handled separately. */
export function followNavigationTasks(
  positions: ComponentStore<Position>,
  movements: ComponentStore<Movement>,
  tasks: ComponentStore<NavigationTask>,
  grid: SpatialGrid,
  tickDurationSeconds: number,
): void {
  const pending = [...tasks.entries()];
  for (const [entityId, task] of pending) {
    const position = positions.get(entityId);
    const movement = movements.get(entityId);
    if (position === undefined || movement === undefined) {
      tasks.remove(entityId);
      if (position === undefined) {
        movements.remove(entityId);
      }
      continue;
    }

    const result = followNavigation(grid, task, position, movement.speed * tickDurationSeconds);
    positions.set(entityId, result.position);
    if (result.task === null) {
      tasks.remove(entityId);
      movements.remove(entityId);
      continue;
    }
    tasks.set(entityId, result.task);
    const waypoint = result.task.waypoints[result.task.waypointIndex];
    if (waypoint === undefined) {
      tasks.remove(entityId);
      movements.remove(entityId);
      continue;
    }
    movements.set(entityId, {
      targetX: waypoint.x,
      targetY: waypoint.y,
      speed: movement.speed,
    });
  }
}

function waypointsForPath(
  grid: SpatialGrid,
  pathCells: readonly CellCoord[],
  destination: Vec2,
): Vec2[] {
  const waypoints: Vec2[] = [];
  for (let index = 1; index < pathCells.length - 1; index += 1) {
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

function sameCell(left: CellCoord, right: CellCoord): boolean {
  return left.x === right.x && left.y === right.y;
}

interface AdvanceStep {
  readonly x: number;
  readonly y: number;
  readonly remaining: number;
  readonly arrived: boolean;
}

/** Continuous step toward one world point. Unused budget is returned for the next waypoint. */
function advanceToward(
  position: Position,
  targetX: number,
  targetY: number,
  budget: number,
): AdvanceStep {
  const dx = targetX - position.x;
  const dy = targetY - position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= ARRIVAL_EPSILON) {
    return { x: targetX, y: targetY, remaining: budget, arrived: true };
  }
  if (distance <= budget) {
    return { x: targetX, y: targetY, remaining: Math.max(0, budget - distance), arrived: true };
  }
  const ratio = budget / distance;
  return {
    x: position.x + dx * ratio,
    y: position.y + dy * ratio,
    remaining: 0,
    arrived: false,
  };
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
