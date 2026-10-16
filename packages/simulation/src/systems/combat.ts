import { getEntityDefinition } from "@web-rts/game-data";
import type { CellCoord } from "@web-rts/game-data";
import { approachGoalCells, planApproach, segmentIsTraversable } from "../navigation.js";
import type { EntityPathQueryLane } from "../path-query-lane.js";
import type { AttackProfile, EntityId, Position, SoldierTask } from "../types.js";
import type { World } from "../world.js";

/** Effective host profile has no mutable cache; the occupant relation is authoritative. */
export function effectiveAttackProfile(world: World, id: EntityId): AttackProfile | undefined {
  const host = world.garrisonHosts.get(id);
  if (host !== undefined) {
    for (const [occupant] of world.occupantsOf(id)) {
      const tags =
        getEntityDefinition(world.identities.get(occupant)?.definitionId ?? "")?.tags ?? [];
      const mapping = host.attackProfiles.find((entry) => tags.includes(entry.occupantTag));
      if (mapping !== undefined) return mapping.profile;
    }
  }
  return world.attacks.get(id);
}

/** Targetability and allegiance are independent requirements. Owner is never consulted. */
export function isValidCombatTarget(
  world: World,
  attackerId: EntityId,
  targetId: EntityId,
): boolean {
  const profile = effectiveAttackProfile(world, attackerId);
  const identity = world.identities.get(targetId);
  const health = world.health.get(targetId);
  return (
    world.hasEntity(attackerId) &&
    world.positions.has(attackerId) &&
    world.positions.has(targetId) &&
    !world.containedIn.has(attackerId) &&
    !world.containedIn.has(targetId) &&
    world.hasEntity(targetId) &&
    attackerId !== targetId &&
    profile !== undefined &&
    identity !== undefined &&
    health !== undefined &&
    health.current > 0 &&
    profile.allowedTargets.includes(identity.kind) &&
    world.relationships.resolve(
      world.teams.get(attackerId)?.teamId,
      world.teams.get(targetId)?.teamId,
    ) === "HOSTILE"
  );
}

/** Distance to the solid rectangle, or to Position for non-solid entities. */
export function targetPoint(
  world: World,
  targetId: EntityId,
  from: Position,
): Position | undefined {
  const position = world.positions.get(targetId);
  const grid = world.grid;
  const footprint = grid?.footprintOf(targetId);
  if (position === undefined || footprint === undefined || grid === null) return position;
  const minX = grid.originX + footprint.anchorCell.x;
  const minY = grid.originY + footprint.anchorCell.y;
  return {
    x: Math.max(minX, Math.min(minX + footprint.width, from.x)),
    y: Math.max(minY, Math.min(minY + footprint.height, from.y)),
  };
}

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function inAttackRange(world: World, attackerId: EntityId, targetId: EntityId): boolean {
  const from = world.positions.get(attackerId);
  const profile = effectiveAttackProfile(world, attackerId);
  if (from === undefined || profile === undefined) return false;
  const to = targetPoint(world, targetId, from);
  if (to === undefined || distance(from, to) > profile.range) return false;
  if (profile.mode === "RANGED" || world.grid === null) return true;
  // End just outside a solid footprint: its own cells are not traversable,
  // but an intervening blocker must still prevent melee through walls.
  const length = distance(from, to);
  const end =
    world.grid.footprintOf(targetId) === undefined || length === 0
      ? to
      : {
          x: to.x + ((from.x - to.x) / length) * 0.0001,
          y: to.y + ((from.y - to.y) / length) * 0.0001,
        };
  return segmentIsTraversable(world.grid, from, end);
}

function targetCell(world: World, targetId: EntityId): number {
  const position = world.positions.get(targetId)!;
  return world.grid?.cellId(world.grid.worldToCell(position)) ?? 0;
}

function release(world: World, id: EntityId, task: SoldierTask): void {
  world.stopNavigation(id);
  task.state = "IDLE";
  task.targetEntityId = null;
  task.anchor = null;
  task.plannedTargetCell = null;
  const combat = world.combats.get(id);
  if (combat !== undefined) combat.targetEntityId = null;
}

/** Called in the same ascending-id lane as movement replans, before displacement. */
export function prepareSoldier(world: World, id: EntityId, lane: EntityPathQueryLane): void {
  const task = world.soldiers.get(id);
  const profile = world.soldierProfiles.get(id);
  const from = world.positions.get(id);
  if (
    task === undefined ||
    profile === undefined ||
    from === undefined ||
    world.garrisonTasks.has(id) ||
    world.containedIn.has(id)
  )
    return;
  if (task.state === "MOVING") return;

  for (const excluded of task.excludedUntilExit) {
    const point = targetPoint(world, excluded, from);
    if (point === undefined || distance(from, point) > profile.aggroRadius)
      task.excludedUntilExit.delete(excluded);
  }
  let targetId = task.targetEntityId;
  if (targetId !== null) {
    const target = targetPoint(world, targetId, task.anchor ?? from);
    if (
      !isValidCombatTarget(world, id, targetId) ||
      target === undefined ||
      task.anchor === null ||
      distance(task.anchor, target) > profile.chaseRadius ||
      distance(task.anchor, from) > profile.chaseRadius
    ) {
      task.excludedUntilExit.add(targetId);
      release(world, id, task);
      return; // Never reacquire/re-anchor inside this tick.
    }
  } else {
    const candidates = world.entityIds().filter((candidate) => {
      if (task.excludedUntilExit.has(candidate) || !isValidCombatTarget(world, id, candidate))
        return false;
      const point = targetPoint(world, candidate, from);
      if (point === undefined || distance(from, point) > profile.aggroRadius) return false;
      const failed = task.unreachable.get(candidate);
      return (
        failed === undefined ||
        failed.cellId !== targetCell(world, candidate) ||
        failed.revision !== world.topologyRevision
      );
    });
    candidates.sort(
      (a, b) =>
        distance(from, targetPoint(world, a, from)!) -
          distance(from, targetPoint(world, b, from)!) || a - b,
    );
    targetId = candidates[0] ?? null;
    if (targetId === null) return;
    task.targetEntityId = targetId;
    task.anchor = { ...from };
    task.state = "ENGAGING";
    world.combats.get(id)!.targetEntityId = targetId;
  }

  if (inAttackRange(world, id, targetId)) {
    world.stopNavigation(id);
    return;
  }
  const cell = targetCell(world, targetId);
  if (world.movements.has(id) && task.plannedTargetCell === cell) return;
  // A stale approach cannot keep moving while a replacement query is deferred.
  world.stopNavigation(id);
  if (!lane.tryReserve(id)) return;
  const grid = world.grid;
  let goals: CellCoord[] = [];
  if (grid !== null) {
    const footprint = grid.footprintOf(targetId);
    goals =
      footprint === undefined
        ? [grid.worldToCell(world.positions.get(targetId)!)]
        : approachGoalCells(grid, footprint);
    const range = world.attacks.get(id)!.range;
    goals = goals.filter(
      (goal) =>
        distance(
          grid.cellToWorldCenter(goal),
          targetPoint(world, targetId, grid.cellToWorldCenter(goal))!,
        ) <= range,
    );
  }
  const navigation = grid === null ? null : planApproach(grid, from, goals);
  if (navigation === null) {
    task.unreachable.set(targetId, { cellId: cell, revision: world.topologyRevision });
    release(world, id, task);
    return;
  }
  task.plannedTargetCell = cell;
  world.startNavigation(id, navigation, profile.moveSpeed);
}

/** First eligible strike is immediate; later strikes are at t + cooldownTicks.
 * Tick t is World.tick before its increment. Ascending entityId resolves attacks
 * sequentially, so an entity killed earlier in the tick cannot retaliate.
 */
export function resolveEntityCombat(world: World, id: EntityId): void {
  if (world.containedIn.has(id) || world.garrisonTasks.has(id)) return;
  const definition = getEntityDefinition(world.identities.get(id)?.definitionId ?? "");
  if (definition?.automaticAttack === true) {
    const combat = world.combats.get(id);
    if (combat === undefined) return;
    if (world.constructions.get(id)?.state !== "COMPLETED") {
      combat.targetEntityId = null;
      return;
    }
    const valid = (target: EntityId) =>
      isValidCombatTarget(world, id, target) && inAttackRange(world, id, target);
    if (combat.targetEntityId === null || !valid(combat.targetEntityId)) {
      const from = world.positions.get(id);
      if (from === undefined) return;
      const candidates = world.entityIds().filter(valid);
      candidates.sort(
        (a, b) =>
          distance(from, targetPoint(world, a, from)!) -
            distance(from, targetPoint(world, b, from)!) || a - b,
      );
      combat.targetEntityId = candidates[0] ?? null;
    }
  }
  const soldier = world.soldiers.get(id);
  if (soldier?.state === "MOVING") {
    if (!world.movements.has(id)) soldier.state = "IDLE";
    return;
  }
  const combat = world.combats.get(id);
  const profile = effectiveAttackProfile(world, id);
  const targetId = combat?.targetEntityId;
  if (combat === undefined || profile === undefined || targetId === null || targetId === undefined)
    return;
  if (!isValidCombatTarget(world, id, targetId)) {
    if (soldier !== undefined) release(world, id, soldier);
    else combat.targetEntityId = null;
    return;
  }
  if (world.tick < combat.nextAttackTick || !inAttackRange(world, id, targetId)) return;
  world.health.get(targetId)!.current -= profile.damage;
  combat.nextAttackTick = world.tick + profile.cooldownTicks;
  if (world.health.get(targetId)!.current <= 0) world.destroyEntity(targetId);
}
