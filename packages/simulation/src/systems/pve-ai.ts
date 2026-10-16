import { ENTITY_DEFINITIONS, getEntityDefinition, type CellCoord } from "@web-rts/game-data";
import { approachGoalCells, planApproach, type NavigationTask } from "../navigation.js";
import { findBreachPath } from "../navigation-breach.js";
import type { EntityPathQueryLane } from "../path-query-lane.js";
import { PVE_TEAM } from "../teams.js";
import type { EnemyAI, EntityId, Position } from "../types.js";
import type { World } from "../world.js";
import { inAttackRange, isValidCombatTarget, targetPoint } from "./combat.js";

/** Trusted low-level setup for G10 and scenario fixtures; no wave scheduling. */
export function spawnEnemy(world: World, position: Position): EntityId {
  const definition = ENTITY_DEFINITIONS.basic_melee_enemy;
  const id = world.createEntity({ kind: definition.kind, definitionId: definition.id });
  world.positions.set(id, { ...position });
  world.teams.set(id, { teamId: PVE_TEAM });
  world.health.set(id, { current: definition.maxHealth, max: definition.maxHealth });
  world.attacks.set(id, { ...definition.attack });
  world.combats.set(id, { targetEntityId: null, nextAttackTick: 0 });
  world.enemies.set(id, {
    phase: "NORMAL_OBJECTIVE",
    objectiveId: null,
    blockerId: null,
    plannedRevision: -1,
    localTargetId: null,
    anchor: null,
    plannedTargetCell: null,
    excludedUntilExit: new Set(),
    unreachable: new Map(),
  });
  return id;
}

export function isBreachable(world: World, id: EntityId, targetId: EntityId): boolean {
  const identity = world.identities.get(targetId);
  return (
    identity !== undefined &&
    getEntityDefinition(identity.definitionId)?.breachable === true &&
    world.grid?.footprintOf(targetId)?.blocksMovement === true &&
    isValidCombatTarget(world, id, targetId)
  );
}

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The generic ring is shared with all interactions. Only breach planning can
 * include occupied hostile breachable cells. Runtime navigation stays unchanged. */
function attackGoals(world: World, id: EntityId, targetId: EntityId, virtual = false): CellCoord[] {
  const grid = world.grid!;
  const footprint = grid.footprintOf(targetId);
  const position = world.positions.get(targetId);
  if (position === undefined) return [];
  const surface = virtual
    ? {
        widthCells: grid.widthCells,
        heightCells: grid.heightCells,
        cellId: (cell: CellCoord) => grid.cellId(cell),
        isCellInBounds: (cell: CellCoord) => grid.isCellInBounds(cell),
        isWalkable: (cell: CellCoord) =>
          grid.isWalkable(cell) ||
          (grid.isStaticWalkable(cell) &&
            grid.occupantAt(cell) !== null &&
            isBreachable(world, id, grid.occupantAt(cell)!)),
      }
    : grid;
  const goals =
    footprint === undefined ? [grid.worldToCell(position)] : approachGoalCells(surface, footprint);
  return goals.filter((cell) => {
    const center = grid.cellToWorldCenter(cell);
    const point = targetPoint(world, targetId, center);
    return point !== undefined && distance(center, point) <= world.attacks.get(id)!.range;
  });
}

function resetStrategy(world: World, id: EntityId, ai: EnemyAI): void {
  world.stopNavigation(id);
  world.combats.get(id)!.targetEntityId = null;
  ai.phase = ai.blockerId === null ? "NORMAL_OBJECTIVE" : "APPROACH_BLOCKER";
  ai.plannedTargetCell = null;
}

function stall(world: World, id: EntityId, ai: EnemyAI): void {
  world.stopNavigation(id);
  world.combats.get(id)!.targetEntityId = null;
  ai.phase = "STALLED";
  ai.plannedRevision = world.topologyRevision;
}

/** Explicit invalidation permits retry without inventing a wall-clock timer. */
export function invalidateEnemy(world: World, id: EntityId): void {
  const ai = world.enemies.get(id);
  if (ai !== undefined) resetStrategy(world, id, ai);
}

function releaseLocal(world: World, id: EntityId, ai: EnemyAI): void {
  ai.localTargetId = null;
  ai.anchor = null;
  resetStrategy(world, id, ai); // Keep a valid sticky blocker across temporary combat.
}

function prepareLocal(world: World, id: EntityId, ai: EnemyAI, lane: EntityPathQueryLane): boolean {
  const from = world.positions.get(id)!;
  const profile = ENTITY_DEFINITIONS.basic_melee_enemy.enemy;
  const grid = world.grid!;
  for (const excluded of ai.excludedUntilExit) {
    const point = world.positions.get(excluded);
    if (point === undefined || distance(from, point) > profile.aggroRadius)
      ai.excludedUntilExit.delete(excluded);
  }
  let target = ai.localTargetId;
  if (target !== null) {
    const point = world.positions.get(target);
    if (
      !isValidCombatTarget(world, id, target) ||
      point === undefined ||
      ai.anchor === null ||
      distance(ai.anchor, point) > profile.chaseRadius ||
      distance(ai.anchor, from) > profile.chaseRadius
    ) {
      ai.excludedUntilExit.add(target);
      releaseLocal(world, id, ai);
      return true; // Never reacquire with a fresh anchor this tick.
    }
  } else {
    const candidates = world
      .entityIds()
      .filter((candidate) => {
        // Local defenders are units, not distant economic/defensive structures.
        if (
          world.identities.get(candidate)?.kind !== "UNIT" ||
          ai.excludedUntilExit.has(candidate) ||
          !isValidCombatTarget(world, id, candidate)
        )
          return false;
        const position = world.positions.get(candidate);
        if (position === undefined || distance(from, position) > profile.aggroRadius) return false;
        const failed = ai.unreachable.get(candidate);
        return (
          failed === undefined ||
          failed.revision !== world.topologyRevision ||
          failed.cellId !== grid.cellId(grid.worldToCell(position))
        );
      })
      .sort(
        (a, b) =>
          distance(from, world.positions.get(a)!) - distance(from, world.positions.get(b)!) ||
          a - b,
      );
    target = candidates[0] ?? null;
    if (target === null) return false;
    world.stopNavigation(id);
    ai.localTargetId = target;
    ai.anchor = { ...from };
    ai.plannedTargetCell = null;
  }
  world.combats.get(id)!.targetEntityId = target;
  if (inAttackRange(world, id, target)) {
    world.stopNavigation(id);
    return true;
  }
  const cell = grid.cellId(grid.worldToCell(world.positions.get(target)!));
  if (world.movements.has(id) && ai.plannedTargetCell === cell) return true;
  world.stopNavigation(id);
  if (!lane.tryReserve(id)) return true;
  const route = planApproach(grid, from, attackGoals(world, id, target));
  // A detour may not escape the fixed acquisition anchor either.
  if (
    route === null ||
    route.pathCells.some(
      (c) => distance(ai.anchor!, grid.cellToWorldCenter(c)) > profile.chaseRadius,
    )
  ) {
    ai.unreachable.set(target, { cellId: cell, revision: world.topologyRevision });
    releaseLocal(world, id, ai);
    return true;
  }
  ai.plannedTargetCell = cell;
  world.startNavigation(id, route, profile.moveSpeed);
  return true;
}

/** Called before Movement, in ascending entityId order, using only the AI lane. */
export function prepareEnemy(world: World, id: EntityId, lane: EntityPathQueryLane): void {
  const ai = world.enemies.get(id);
  if (ai === undefined || world.positions.get(id) === undefined || world.grid === null) return;
  // Stable objective choice: lowest eligible objectiveId, irrespective of distance.
  const objectiveEntry = world
    .objectiveEntries()
    .find(
      ([, objective]) =>
        objective.type === "PROTECT" &&
        objective.state === "ACTIVE" &&
        world.relationships.resolve(world.teams.get(id)?.teamId, objective.teamId) === "HOSTILE" &&
        isValidCombatTarget(world, id, objective.targetEntityId),
    );
  const objectiveId = objectiveEntry?.[0] ?? null;
  if (ai.objectiveId !== objectiveId) {
    ai.objectiveId = objectiveId;
    ai.blockerId = null;
    resetStrategy(world, id, ai);
  }
  if (ai.blockerId !== null && !isBreachable(world, id, ai.blockerId)) {
    ai.blockerId = null;
    if (ai.localTargetId === null) resetStrategy(world, id, ai);
  }
  if (prepareLocal(world, id, ai, lane)) return;
  if (objectiveEntry === undefined) {
    stall(world, id, ai);
    return;
  }
  if (ai.phase === "STALLED") {
    if (ai.plannedRevision === world.topologyRevision) return;
    resetStrategy(world, id, ai);
  }
  if (ai.phase === "BREACH_SEARCH" && ai.plannedRevision !== world.topologyRevision)
    resetStrategy(world, id, ai);
  const target = ai.blockerId ?? objectiveEntry[1].targetEntityId;
  if (inAttackRange(world, id, target)) {
    world.stopNavigation(id);
    world.combats.get(id)!.targetEntityId = target;
    ai.phase = "ATTACKING";
    return;
  }
  if (world.movements.has(id)) return;
  world.combats.get(id)!.targetEntityId = null;
  if (ai.phase === "ADVANCING" || ai.phase === "ATTACKING") resetStrategy(world, id, ai);
  if (!lane.tryReserve(id)) return;
  const grid = world.grid;
  const from = world.positions.get(id)!;
  ai.plannedRevision = world.topologyRevision;
  if (ai.phase === "BREACH_SEARCH") {
    const result = findBreachPath(
      grid,
      grid.worldToCell(from),
      attackGoals(world, id, objectiveEntry[1].targetEntityId, true),
      (candidate) => isBreachable(world, id, candidate),
      { allowBreachableGoals: true },
    );
    if (result.status === "found" && result.firstBlockerEntityId !== null) {
      ai.blockerId = result.firstBlockerEntityId;
      ai.phase = "APPROACH_BLOCKER";
    } else stall(world, id, ai);
    return;
  }
  const route = planApproach(grid, from, attackGoals(world, id, target));
  if (route === null) {
    if (ai.blockerId === null) ai.phase = "BREACH_SEARCH";
    else {
      ai.blockerId = null; // Unreachable blocker invalidates stickiness.
      stall(world, id, ai);
    }
    return;
  }
  ai.phase = "ADVANCING";
  world.combats.get(id)!.targetEntityId = target;
  world.startNavigation(id, route, ENTITY_DEFINITIONS.basic_melee_enemy.enemy.moveSpeed);
}

/** Movement still validates every segment; its replan uses the same AI lane. */
export function replanEnemyNavigation(
  world: World,
  id: EntityId,
): (() => NavigationTask | null) | undefined {
  const ai = world.enemies.get(id);
  if (ai === undefined) return undefined;
  return () => {
    const target =
      ai.localTargetId ??
      ai.blockerId ??
      (ai.objectiveId === null ? undefined : world.getObjective(ai.objectiveId)?.targetEntityId);
    if (target === undefined || !isValidCombatTarget(world, id, target)) return null;
    const route = planApproach(
      world.grid!,
      world.positions.get(id)!,
      attackGoals(world, id, target),
    );
    if (
      ai.localTargetId !== null &&
      route !== null &&
      route.pathCells.some(
        (cell) =>
          distance(ai.anchor!, world.grid!.cellToWorldCenter(cell)) >
          ENTITY_DEFINITIONS.basic_melee_enemy.enemy.chaseRadius,
      )
    )
      return null;
    return route;
  };
}

export function failedEnemyNavigation(world: World, id: EntityId): void {
  const ai = world.enemies.get(id);
  if (ai === undefined) return;
  if (ai.localTargetId !== null) {
    const position = world.positions.get(ai.localTargetId);
    if (position !== undefined)
      ai.unreachable.set(ai.localTargetId, {
        cellId: world.grid!.cellId(world.grid!.worldToCell(position)),
        revision: world.topologyRevision,
      });
    releaseLocal(world, id, ai);
  } else if (ai.blockerId !== null) {
    ai.blockerId = null;
    stall(world, id, ai);
  } else {
    world.combats.get(id)!.targetEntityId = null;
    ai.phase = "BREACH_SEARCH";
    ai.plannedRevision = world.topologyRevision;
  }
}
