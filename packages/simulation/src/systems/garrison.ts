import { getEntityDefinition } from "@web-rts/game-data";
import type { CommandRejectionReason, SimulationCommand } from "../commands.js";
import { approachGoalCells, planApproach, type NavigationTask } from "../navigation.js";
import type { EntityPathQueryLane } from "../path-query-lane.js";
import type { EntityId, PlayerId } from "../types.js";
import type { World } from "../world.js";

type GarrisonRefusal =
  | "entity_not_found"
  | "not_controller"
  | "entity_not_spatial"
  | "invalid_garrison_host"
  | "host_not_completed"
  | "invalid_owner"
  | "ineligible_occupant"
  | "no_garrison_slot";

type GarrisonCommand = Extract<SimulationCommand, { type: "GARRISON" }>;

function freeSlot(world: World, host: EntityId): number | null {
  const capability = world.garrisonHosts.get(host);
  if (capability === undefined) return null;
  const used = new Set(world.occupantsOf(host).map(([, relation]) => relation.slotIndex));
  for (let slot = 0; slot < capability.capacity; slot++) if (!used.has(slot)) return slot;
  return null;
}

/** Same assessment at admission and entry; no mutable slot reservations. */
function validate(
  world: World,
  player: PlayerId,
  unit: EntityId,
  host: EntityId,
): GarrisonRefusal | null {
  if (!world.hasEntity(unit) || (world.health.get(unit)?.current ?? 0) <= 0)
    return "entity_not_found";
  if (world.controllers.get(unit)?.controllerPlayerId !== player) return "not_controller";
  if (!world.positions.has(unit) || world.containedIn.has(unit)) return "entity_not_spatial";
  if (!world.hasEntity(host) || (world.health.get(host)?.current ?? 0) <= 0)
    return "entity_not_found";
  const capability = world.garrisonHosts.get(host);
  if (capability === undefined || world.grid?.footprintOf(host) === undefined)
    return "invalid_garrison_host";
  if (world.constructions.get(host)?.state !== "COMPLETED") return "host_not_completed";
  const owner = world.owners.get(unit)?.ownerPlayerId;
  if (owner === undefined || owner === null || world.owners.get(host)?.ownerPlayerId !== owner)
    return "invalid_owner";
  const identity = world.identities.get(unit);
  const tags = getEntityDefinition(identity?.definitionId ?? "")?.tags ?? [];
  if (
    identity?.kind !== "UNIT" ||
    !capability.allowedOccupantTags.some((tag) => tags.includes(tag))
  )
    return "ineligible_occupant";
  return freeSlot(world, host) === null ? "no_garrison_slot" : null;
}

function plan(world: World, unit: EntityId, host: EntityId): NavigationTask | null {
  const footprint = world.grid?.footprintOf(host);
  const position = world.positions.get(unit);
  return footprint === undefined || position === undefined
    ? null
    : planApproach(world.grid!, position, approachGoalCells(world.grid!, footprint));
}

export function assessGarrison(
  world: World,
  player: PlayerId,
  command: GarrisonCommand,
): { reason: CommandRejectionReason } | { navigation: NavigationTask } {
  const reason = validate(world, player, command.unitEntityId, command.containerEntityId);
  if (reason !== null) return { reason };
  const navigation = plan(world, command.unitEntityId, command.containerEntityId);
  return navigation === null ? { reason: "no_path" } : { navigation };
}

export function commitGarrison(
  world: World,
  playerId: PlayerId,
  command: GarrisonCommand,
  navigation: NavigationTask,
): void {
  const id = command.unitEntityId;
  world.buildTasks.remove(id);
  world.gatherTasks.remove(id);
  world.stopNavigation(id);
  world.resetSoldier(id);
  world.garrisonTasks.set(id, {
    commandId: command.commandId,
    playerId,
    containerEntityId: command.containerEntityId,
  });
  world.startNavigation(
    id,
    navigation,
    world.soldierProfiles.get(id)?.moveSpeed ??
      world.workers.get(id)?.moveSpeed ??
      world.config.defaultMoveSpeed,
  );
}

function enterIfArrived(world: World, id: EntityId): void {
  const task = world.garrisonTasks.get(id);
  if (task === undefined) return;
  const footprint = world.grid?.footprintOf(task.containerEntityId);
  const position = world.positions.get(id);
  if (footprint === undefined || position === undefined) return;
  const arrived = approachGoalCells(world.grid!, footprint).some((cell) => {
    const center = world.grid!.cellToWorldCenter(cell);
    return Math.hypot(position.x - center.x, position.y - center.y) < 1e-6;
  });
  if (!arrived) return;
  const reason = validate(world, task.playerId, id, task.containerEntityId);
  if (reason !== null) {
    world.failGarrison(id, reason === "entity_not_found" ? "target_removed" : reason);
    return;
  }
  const slotIndex = freeSlot(world, task.containerEntityId)!;
  world.stopNavigation(id);
  world.resetSoldier(id);
  world.positions.remove(id);
  world.containedIn.set(id, { containerEntityId: task.containerEntityId, slotIndex });
  world.garrisonTasks.remove(id);
}

export function garrisonHooks(world: World, lane: EntityPathQueryLane) {
  return {
    entityIds: [...world.garrisonTasks.entries()].map(([id]) => id),
    failedNavigation: (id: EntityId) => world.failGarrison(id, "path_blocked"),
    replanNavigation(id: EntityId): (() => NavigationTask | null) | undefined {
      const task = world.garrisonTasks.get(id);
      return task === undefined ? undefined : () => plan(world, id, task.containerEntityId);
    },
    beforeMovement(id: EntityId): void {
      const task = world.garrisonTasks.get(id);
      if (task === undefined) return;
      if (
        !world.hasEntity(task.containerEntityId) ||
        (world.health.get(task.containerEntityId)?.current ?? 0) <= 0
      ) {
        world.failGarrison(id, "target_removed");
        return;
      }
      enterIfArrived(world, id);
      if (world.garrisonTasks.has(id) && !world.movements.has(id) && lane.tryReserve(id)) {
        const navigation = plan(world, id, task.containerEntityId);
        if (navigation === null) world.failGarrison(id, "path_blocked");
        else
          world.startNavigation(
            id,
            navigation,
            world.soldierProfiles.get(id)?.moveSpeed ?? world.config.defaultMoveSpeed,
          );
      }
    },
    afterMovement: (id: EntityId) => enterIfArrived(world, id),
  };
}

export function ungarrison(
  world: World,
  player: PlayerId,
  unit: EntityId,
): CommandRejectionReason | null {
  if (!world.hasEntity(unit)) return "entity_not_found";
  if (world.controllers.get(unit)?.controllerPlayerId !== player) return "not_controller";
  const relation = world.containedIn.get(unit);
  if (relation === undefined) return "not_contained";
  const footprint = world.grid?.footprintOf(relation.containerEntityId);
  if (footprint === undefined) return "invalid_garrison_host";
  const exit = approachGoalCells(world.grid!, footprint).sort(
    (a, b) => world.grid!.cellId(a) - world.grid!.cellId(b),
  )[0];
  if (exit === undefined) return "no_exit";
  world.containedIn.remove(unit);
  world.positions.set(unit, world.grid!.cellToWorldCenter(exit));
  world.resetSoldier(unit);
  return null;
}

/** Destruction removes blocking topology before resolving any occupant's exit. */
export function forceEjectOccupants(world: World, host: EntityId): void {
  const occupants = world.occupantsOf(host);
  const grid = world.grid;
  const footprint = grid?.footprintOf(host);
  const position = world.positions.get(host);
  world.removeSolidFootprint(host);
  if (occupants.length === 0) return;
  // Occupants never die with the host (#002 §15.7). Placement guarantees a statically
  // walkable anchor; a lost host Position is recovered from its footprint.
  if (grid === null || (footprint === undefined && position === undefined))
    throw new Error("garrison host without spatial location violates the containment invariant");
  const anchor = footprint?.anchorCell ?? grid.worldToCell(position!);
  let exit = grid.isWalkable(anchor) ? anchor : undefined;
  if (exit === undefined) {
    // Forced ejection may cross blocked topology, unlike normal UNGARRISON.
    const candidates = [];
    for (let y = 0; y < grid.heightCells; y++)
      for (let x = 0; x < grid.widthCells; x++) {
        const cell = { x, y };
        if (grid.isWalkable(cell)) candidates.push(cell);
      }
    candidates.sort(
      (a, b) =>
        Math.abs(a.x - anchor.x) +
          Math.abs(a.y - anchor.y) -
          (Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y)) || grid.cellId(a) - grid.cellId(b),
    );
    // A fully blocked map is still not allowed to kill or lose the occupant.
    exit = candidates[0] ?? anchor;
  }
  for (const [unit] of occupants) {
    world.containedIn.remove(unit);
    world.positions.set(unit, grid.cellToWorldCenter(exit));
    world.stopNavigation(unit);
    world.garrisonTasks.remove(unit);
    world.resetSoldier(unit);
  }
}
