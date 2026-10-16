import { getEntityDefinition, type EntityDefinition } from "@web-rts/game-data";
import type { CommandRejectionReason, SimulationCommand } from "../commands.js";
import { approachGoalCells, planApproach, type NavigationTask } from "../navigation.js";
import type { EntityPathQueryLane } from "../path-query-lane.js";
import type { SpatialFootprint } from "../spatial-grid.js";
import type { EntityId, PlayerId } from "../types.js";
import type { World } from "../world.js";

type BuildCommand = Extract<SimulationCommand, { type: "BUILD" }>;
type Assessment =
  | { reason: CommandRejectionReason }
  | {
      navigation: NavigationTask;
      target:
        | {
            type: "NEW";
            definition: EntityDefinition;
            footprint: SpatialFootprint;
            owner: PlayerId;
          }
        | { type: "EXISTING"; entityId: EntityId };
    };

/** Pure admission: the single query sees NEW's future solid footprint. */
export function assessBuild(world: World, playerId: PlayerId, command: BuildCommand): Assessment {
  const id = command.builderEntityId;
  const worker = world.workers.get(id);
  const position = world.positions.get(id);
  if (
    !world.hasEntity(id) ||
    worker === undefined ||
    position === undefined ||
    world.identities.get(id)?.kind !== "UNIT" ||
    (world.health.get(id)?.current ?? 1) <= 0
  )
    return { reason: "not_worker" };
  if (world.controllers.get(id)?.controllerPlayerId !== playerId)
    return { reason: "not_your_unit" };
  if (worker.builder !== true) return { reason: "not_builder" };
  const owner = world.owners.get(id)?.ownerPlayerId;
  if (owner === undefined || owner === null) return { reason: "invalid_owner" };
  const grid = world.grid;
  if (grid === null) return { reason: "invalid_placement" };
  if (command.target.type === "NEW") {
    const definition = getEntityDefinition(command.target.buildingTypeId);
    if (
      definition?.construction === undefined ||
      definition.kind !== "BUILDING" ||
      definition.footprint === null ||
      definition.maxHealth === undefined
    )
      return { reason: "invalid_building" };
    const economy = world.playerEconomies.get(owner);
    if (economy === undefined) return { reason: "invalid_owner" };
    if (economy.resources.WOOD < definition.construction.woodCost)
      return { reason: "insufficient_resources" };
    const footprint = { ...definition.footprint, anchorCell: { ...command.target.anchorCell } };
    if (!world.canPlaceSolidFootprint(footprint).ok) return { reason: "invalid_placement" };
    // A garrison host must leave a statically walkable cell behind so that forced
    // ejection can always restore its occupants to a valid Position (buildable != walkable).
    if (
      definition.garrisonHost !== undefined &&
      !grid.footprintCells(footprint).every((cell) => grid.isStaticWalkable(cell))
    )
      return { reason: "invalid_placement" };
    const preview = grid.previewFootprint(footprint);
    const navigation = planApproach(preview, position, approachGoalCells(preview, footprint));
    if (navigation === null) return { reason: "no_path" };
    return { navigation, target: { type: "NEW", definition, footprint, owner } };
  }
  const site = command.target.constructionEntityId;
  const construction = world.constructions.get(site);
  const footprint = grid.footprintOf(site);
  if (
    !world.hasEntity(site) ||
    construction?.state !== "UNDER_CONSTRUCTION" ||
    footprint === undefined ||
    (world.health.get(site)?.current ?? 0) <= 0
  )
    return { reason: "invalid_construction" };
  if (world.owners.get(site)?.ownerPlayerId !== owner) return { reason: "invalid_owner" };
  for (const [builder, task] of world.buildTasks.entries()) {
    if (task.constructionEntityId === site)
      return { reason: builder === id ? "already_building" : "construction_busy" };
  }
  const navigation = planApproach(grid, position, approachGoalCells(grid, footprint));
  return navigation === null
    ? { reason: "no_path" }
    : { navigation, target: { type: "EXISTING", entityId: site } };
}

/** Commit only an entirely validated command; no calls to gameplay rejection after spend. */
export function commitBuild(
  world: World,
  playerId: PlayerId,
  command: BuildCommand,
  assessment: Exclude<Assessment, { reason: CommandRejectionReason }>,
): void {
  let site: EntityId;
  const target = assessment.target;
  if (target.type === "NEW") {
    const def = target.definition;
    world.playerEconomies.get(target.owner)!.resources.WOOD -= def.construction!.woodCost;
    site = world.createEntity({ kind: def.kind, definitionId: def.id });
    world.positions.set(site, world.grid!.footprintWorldCenter(target.footprint));
    world.owners.set(site, { ownerPlayerId: target.owner });
    const team = world.teams.get(command.builderEntityId);
    if (team !== undefined) world.teams.set(site, { ...team });
    world.health.set(site, { current: def.maxHealth!, max: def.maxHealth! });
    world.constructions.set(site, {
      state: "UNDER_CONSTRUCTION",
      workedTicks: 0,
      durationTicks: def.construction!.durationTicks,
    });
    world.placeSolidFootprint(site, target.footprint);
  } else site = target.entityId;
  const id = command.builderEntityId;
  world.garrisonTasks.remove(id);
  world.gatherTasks.remove(id);
  world.stopNavigation(id);
  world.buildTasks.set(id, { commandId: command.commandId, playerId, constructionEntityId: site });
  world.startNavigation(id, assessment.navigation, world.workers.get(id)!.moveSpeed);
}

/** Task hooks participate in the existing Movement executor and active-task lane. */
export function constructionHooks(world: World, lane: EntityPathQueryLane) {
  const arrived = (id: EntityId, site: EntityId): boolean => {
    const position = world.positions.get(id);
    const footprint = world.grid?.footprintOf(site);
    return (
      position !== undefined &&
      footprint !== undefined &&
      approachGoalCells(world.grid!, footprint).some((cell) => {
        const center = world.grid!.cellToWorldCenter(cell);
        return Math.hypot(position.x - center.x, position.y - center.y) < 1e-6;
      })
    );
  };
  const plan = (id: EntityId): NavigationTask | null => {
    const task = world.buildTasks.get(id)!;
    const footprint = world.grid?.footprintOf(task.constructionEntityId);
    const position = world.positions.get(id);
    return footprint === undefined || position === undefined
      ? null
      : planApproach(world.grid!, position, approachGoalCells(world.grid!, footprint));
  };
  return {
    entityIds: [...world.buildTasks.entries()].map(([id]) => id),
    failedNavigation: (id: EntityId) => world.failBuild(id, "path_blocked"),
    replanNavigation(id: EntityId): (() => NavigationTask | null) | undefined {
      return world.buildTasks.has(id) ? () => plan(id) : undefined;
    },
    beforeMovement(id: EntityId): void {
      const task = world.buildTasks.get(id);
      if (task === undefined) return;
      const site = world.constructions.get(task.constructionEntityId);
      if (
        !world.hasEntity(task.constructionEntityId) ||
        site === undefined ||
        (world.health.get(task.constructionEntityId)?.current ?? 0) <= 0
      ) {
        world.failBuild(id, "target_removed");
        return;
      }
      if (site.state === "COMPLETED") {
        world.buildTasks.remove(id);
        world.stopNavigation(id);
        return;
      }
      if (!world.workers.has(id) || !world.positions.has(id)) {
        world.failBuild(id, "path_blocked");
        return;
      }
      if (arrived(id, task.constructionEntityId)) {
        world.stopNavigation(id);
        site.workedTicks += 1;
        if (site.workedTicks >= site.durationTicks) {
          site.state = "COMPLETED";
          world.buildTasks.remove(id);
        }
        return;
      }
      if (!world.movements.has(id) && lane.tryReserve(id)) {
        const navigation = plan(id);
        if (navigation === null) world.failBuild(id, "path_blocked");
        else world.startNavigation(id, navigation, world.workers.get(id)!.moveSpeed);
      }
    },
  };
}
