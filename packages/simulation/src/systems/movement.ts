import type { ComponentStore } from "../component-store.js";
import { prepareNavigation, type NavigationTask } from "../navigation.js";
import type { EntityPathQueryLane } from "../path-query-lane.js";
import type { SpatialGrid } from "../spatial-grid.js";
import type { EntityId, Movement, Position } from "../types.js";

const ARRIVAL_EPSILON = 1e-6;

/** The sole continuous displacement primitive, shared by direct and routed MOVE. */
export function advanceToward(
  position: Position,
  target: Position,
  budget: number,
): {
  position: Position;
  remaining: number;
  arrived: boolean;
} {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= budget || distance <= ARRIVAL_EPSILON) {
    return { position: { ...target }, remaining: Math.max(0, budget - distance), arrived: true };
  }
  const ratio = budget / distance;
  return {
    position: { x: position.x + dx * ratio, y: position.y + dy * ratio },
    remaining: 0,
    arrived: false,
  };
}

/** Movement owns Position integration and preserves budget across waypoint arrivals. */
export function runMovementSystem(
  positions: ComponentStore<Position>,
  movements: ComponentStore<Movement>,
  tickDurationSeconds: number,
  navigation?: {
    tasks: ComponentStore<NavigationTask>;
    grid: SpatialGrid;
    lane: EntityPathQueryLane;
  },
  tasks?: {
    entityIds: readonly EntityId[];
    beforeMovement(entityId: EntityId): void;
    afterMovement(entityId: EntityId): void;
    failedNavigation(entityId: EntityId): void;
    replanNavigation(entityId: EntityId): (() => NavigationTask | null) | undefined;
  },
): void {
  const ids = [
    ...new Set([...movements.entries()].map(([id]) => id).concat(tasks?.entityIds ?? [])),
  ].sort((a, b) => a - b);
  for (const entityId of ids) {
    tasks?.beforeMovement(entityId);
    const movement = movements.get(entityId);
    if (movement === undefined) {
      tasks?.afterMovement(entityId);
      continue;
    }
    let position = positions.get(entityId);
    if (position === undefined) {
      movements.remove(entityId);
      navigation?.tasks.remove(entityId);
      continue;
    }
    let task = navigation?.tasks.get(entityId);
    let remaining = movement.speed * tickDurationSeconds;
    while (true) {
      if (task !== undefined && navigation !== undefined) {
        const prepared = prepareNavigation(
          navigation.grid,
          task,
          position,
          () => navigation.lane.tryReserve(entityId),
          tasks?.replanNavigation(entityId),
        );
        if (prepared === "deferred") break;
        if (prepared === null) {
          tasks?.failedNavigation(entityId);
          navigation.tasks.remove(entityId);
          movements.remove(entityId);
          break;
        }
        task = prepared;
      }
      const waypoint = task?.waypoints[task.waypointIndex] ?? {
        x: movement.targetX,
        y: movement.targetY,
      };
      const step = advanceToward(position, waypoint, remaining);
      position = step.position;
      positions.set(entityId, position);
      remaining = step.remaining;
      if (!step.arrived) {
        if (task !== undefined && navigation !== undefined) {
          navigation.tasks.set(entityId, task);
          movements.set(entityId, {
            targetX: waypoint.x,
            targetY: waypoint.y,
            speed: movement.speed,
          });
        }
        break;
      }
      if (task === undefined || task.waypointIndex + 1 >= task.waypoints.length) {
        navigation?.tasks.remove(entityId);
        movements.remove(entityId);
        break;
      }
      // Every newly active segment must be validated, even if an earlier segment
      // was already checked against this topology revision.
      task = { ...task, waypointIndex: task.waypointIndex + 1, validatedRevision: -1 };
      navigation?.tasks.set(entityId, task);
      const next = task.waypoints[task.waypointIndex]!;
      movements.set(entityId, { targetX: next.x, targetY: next.y, speed: movement.speed });
      if (remaining <= 0) break;
    }
    tasks?.afterMovement(entityId);
  }
}
