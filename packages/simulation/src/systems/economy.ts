import type { CellCoord } from "@web-rts/game-data";
import type { CommandRejectionReason, SimulationCommand } from "../commands.js";
import type { ComponentStore } from "../component-store.js";
import type { EventQueue } from "../events.js";
import {
  approachGoalCells,
  findPath,
  findPathsToGoalSets,
  navigationForPath,
  type NavigationTask,
} from "../navigation.js";
import type { EntityPathQueryLane } from "../path-query-lane.js";
import type { EntityId, GatherTask, PlayerId } from "../types.js";
import type { World } from "../world.js";

type GatherCommand = Extract<SimulationCommand, { type: "GATHER" }>;

function goals(world: World, target: EntityId): CellCoord[] {
  const footprint = world.grid?.footprintOf(target);
  return footprint === undefined ? [] : approachGoalCells(world.grid!, footprint);
}

function validDropoff(world: World, workerId: EntityId, target: EntityId): boolean {
  const owner = world.owners.get(workerId)?.ownerPlayerId;
  const worker = world.workers.get(workerId);
  return (
    owner !== undefined &&
    owner !== null &&
    worker !== undefined &&
    world.hasEntity(target) &&
    world.owners.get(target)?.ownerPlayerId === owner &&
    world.dropoffs.get(target)?.resourceTypes.includes(worker.carried.resourceType) === true &&
    world.playerEconomies.has(owner) &&
    goals(world, target).length > 0
  );
}

/** Admission uses one grouped A* query: source reachability + nearest reachable drop-off
 * from the Worker's current cell. Distance, then entityId, then row-major goal cell.
 * Pin that drop-off for the entire task; later invalidation never auto-selects another.
 */
export function assessGather(
  world: World,
  playerId: PlayerId,
  command: GatherCommand,
): { reason: CommandRejectionReason } | { task: GatherTask; navigation: NavigationTask } {
  const id = command.workerEntityId;
  const worker = world.workers.get(id);
  const position = world.positions.get(id);
  if (!world.hasEntity(id) || worker === undefined || position === undefined)
    return { reason: "not_worker" };
  if (world.controllers.get(id)?.controllerPlayerId !== playerId)
    return { reason: "not_your_unit" };
  const node = world.resourceNodes.get(command.resourceEntityId);
  if (
    !world.hasEntity(command.resourceEntityId) ||
    node === undefined ||
    node.remaining <= 0 ||
    node.resourceType !== worker.carried.resourceType
  )
    return { reason: "invalid_resource" };
  const candidates = [...world.dropoffs.entries()]
    .map(([entityId]) => entityId)
    .filter((target) => validDropoff(world, id, target))
    .sort((a, b) => a - b);
  if (candidates.length === 0) return { reason: "no_dropoff" };
  const grid = world.grid;
  if (grid === null) return { reason: "no_path" };
  const dropoffGoals = candidates.flatMap((target) => goals(world, target));
  const [sourcePath, dropoffPath] = findPathsToGoalSets(grid, grid.worldToCell(position), [
    goals(world, command.resourceEntityId),
    dropoffGoals,
  ]);
  if (!dropoffPath) return { reason: "no_path" };
  if (!sourcePath) return { reason: "no_path" };
  const selectedGoal = grid.cellId(dropoffPath[dropoffPath.length - 1]!);
  const dropoffEntityId = candidates.find((target) =>
    goals(world, target).some((cell) => grid.cellId(cell) === selectedGoal),
  )!;
  const carryingFull = worker.carried.amount >= worker.carryCapacity;
  const path = carryingFull ? dropoffPath : sourcePath;
  const navigation = navigationForPath(
    grid,
    position,
    path,
    grid.cellToWorldCenter(path[path.length - 1]!),
  );
  if (navigation === null) return { reason: "no_path" };
  return {
    task: {
      commandId: command.commandId,
      playerId,
      sourceEntityId: command.resourceEntityId,
      dropoffEntityId,
      phase: carryingFull ? "TO_DROPOFF" : "TO_SOURCE",
      gatherProgress: 0,
    },
    navigation,
  };
}

export function installGatherNavigation(
  world: World,
  navigations: ComponentStore<NavigationTask>,
  id: EntityId,
  navigation: NavigationTask,
): void {
  navigations.set(id, navigation);
  const point = navigation.waypoints[0]!;
  world.movements.set(id, {
    targetX: point.x,
    targetY: point.y,
    speed: world.workers.get(id)!.moveSpeed,
  });
}

/** One entity at a time, interleaved with the sole movement system in ascending id order. */
export function economyHooks(
  world: World,
  navigations: ComponentStore<NavigationTask>,
  lane: EntityPathQueryLane,
  events: EventQueue,
) {
  const stop = (id: EntityId): void => {
    world.gatherTasks.remove(id);
    world.movements.remove(id);
    navigations.remove(id);
  };
  const fail = (id: EntityId, reason: "no_dropoff" | "target_removed" | "path_blocked"): void => {
    const task = world.gatherTasks.get(id);
    if (task === undefined) return;
    events.push({
      type: "ACTION_FAILED",
      commandId: task.commandId,
      playerId: task.playerId,
      entityId: id,
      action: "GATHER",
      reason,
      tick: world.tick,
    });
    stop(id);
  };
  const arrived = (id: EntityId, target: EntityId): boolean => {
    const position = world.positions.get(id);
    if (position === undefined || world.grid === null) return false;
    return goals(world, target).some((cell) => {
      const center = world.grid!.cellToWorldCenter(cell);
      return Math.hypot(position.x - center.x, position.y - center.y) < 1e-6;
    });
  };
  return {
    entityIds: [...world.gatherTasks.entries()].map(([id]) => id),
    failedNavigation: (id: EntityId) => fail(id, "path_blocked"),
    replanNavigation(id: EntityId): (() => NavigationTask | null) | undefined {
      const task = world.gatherTasks.get(id);
      if (task === undefined) return undefined;
      return () => {
        const grid = world.grid!;
        const position = world.positions.get(id)!;
        const target = task.phase === "TO_DROPOFF" ? task.dropoffEntityId : task.sourceEntityId;
        const path = findPath(grid, grid.worldToCell(position), goals(world, target));
        return path === null
          ? null
          : navigationForPath(grid, position, path, grid.cellToWorldCenter(path[path.length - 1]!));
      };
    },
    beforeMovement(id: EntityId): void {
      const task = world.gatherTasks.get(id);
      const worker = world.workers.get(id);
      if (task === undefined || worker === undefined) return;
      if (!world.positions.has(id)) {
        fail(id, "path_blocked");
        return;
      }
      if (!validDropoff(world, id, task.dropoffEntityId)) {
        fail(id, "no_dropoff");
        return;
      }
      const node = world.resourceNodes.get(task.sourceEntityId);
      if (
        task.phase !== "TO_DROPOFF" &&
        (node === undefined ||
          node.remaining <= 0 ||
          node.resourceType !== worker.carried.resourceType)
      ) {
        if (worker.carried.amount > 0) {
          task.phase = "TO_DROPOFF";
          world.movements.remove(id);
          navigations.remove(id);
        } else {
          if (node === undefined) fail(id, "target_removed");
          else stop(id);
          return;
        }
      }
      if (task.phase === "GATHERING") {
        if (!arrived(id, task.sourceEntityId)) {
          task.phase = "TO_SOURCE";
        } else {
          task.gatherProgress += worker.gatherRate * world.config.tickDurationSeconds;
          const amount = Math.min(
            Math.floor(task.gatherProgress + 1e-9),
            worker.carryCapacity - worker.carried.amount,
            node!.remaining,
          );
          task.gatherProgress -= amount;
          node!.remaining -= amount;
          worker.carried.amount += amount;
          if (worker.carried.amount >= worker.carryCapacity || node!.remaining === 0)
            task.phase = "TO_DROPOFF";
          return; // next leg participates in the next tick's lane
        }
      }
      if (!world.movements.has(id)) {
        const target = task.phase === "TO_DROPOFF" ? task.dropoffEntityId : task.sourceEntityId;
        if (arrived(id, target)) return;
        if (!lane.tryReserve(id)) return;
        const grid = world.grid!;
        const position = world.positions.get(id)!;
        const path = findPath(grid, grid.worldToCell(position), goals(world, target));
        const navigation =
          path === null
            ? null
            : navigationForPath(
                grid,
                position,
                path,
                grid.cellToWorldCenter(path[path.length - 1]!),
              );
        if (navigation === null) {
          fail(id, "path_blocked");
          return;
        }
        installGatherNavigation(world, navigations, id, navigation);
      }
    },
    afterMovement(id: EntityId): void {
      const task = world.gatherTasks.get(id);
      if (task === undefined || world.movements.has(id)) return;
      if (task.phase === "TO_SOURCE" && arrived(id, task.sourceEntityId)) {
        const node = world.resourceNodes.get(task.sourceEntityId);
        if (node !== undefined && node.remaining > 0) task.phase = "GATHERING";
        return;
      }
      if (task.phase === "TO_DROPOFF" && arrived(id, task.dropoffEntityId)) {
        if (!validDropoff(world, id, task.dropoffEntityId)) {
          fail(id, "no_dropoff");
          return;
        }
        const worker = world.workers.get(id)!;
        const economy = world.playerEconomies.get(world.owners.get(id)!.ownerPlayerId!)!;
        economy.resources[worker.carried.resourceType] += worker.carried.amount;
        worker.carried.amount = 0; // atomic deposit, no resource mutation before interaction
        const node = world.resourceNodes.get(task.sourceEntityId);
        if (
          node === undefined ||
          node.remaining <= 0 ||
          node.resourceType !== worker.carried.resourceType
        )
          stop(id);
        else {
          task.phase = "TO_SOURCE";
          task.gatherProgress = 0;
        }
      }
    },
  };
}
