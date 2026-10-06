import type { EntityId, EntityKind, Objective, ObjectiveState, ObjectiveType } from "./types.js";
import type { World } from "./world.js";

/**
 * Transport-neutral entity read. match-adapter projects it into GameStateView.
 * It is not a wire DTO and does not import protocol.
 */
export type MatchEntitySnapshot = {
  entityId: EntityId;
  kind: EntityKind;
  definitionId: string;
  x: number;
  y: number;
  ownerPlayerId: number | null;
  controllerPlayerId: number | null;
  /** Generic objective role targeting this entity, if any. */
  objectiveType: ObjectiveType | null;
  objectiveState: ObjectiveState | null;
};

/**
 * Fresh plain objects on every call, in ascending entity id order. Kind and
 * definitionId come from the Identity component. Entities without a position
 * are omitted until a discriminated location lands (G11).
 * Component stores are not exposed.
 */
export function readWorldEntities(world: World): MatchEntitySnapshot[] {
  const objectiveByTarget = new Map<EntityId, Objective>();
  for (const [, objective] of world.objectiveEntries()) {
    if (!objectiveByTarget.has(objective.targetEntityId)) {
      objectiveByTarget.set(objective.targetEntityId, objective);
    }
  }

  const entities: MatchEntitySnapshot[] = [];
  for (const entityId of world.entityIds()) {
    const identity = world.identities.get(entityId);
    const position = world.positions.get(entityId);
    if (identity === undefined || position === undefined) {
      continue;
    }
    const objective = objectiveByTarget.get(entityId);
    const owner = world.owners.get(entityId);
    const controller = world.controllers.get(entityId);
    entities.push({
      entityId,
      kind: identity.kind,
      definitionId: identity.definitionId,
      x: position.x,
      y: position.y,
      ownerPlayerId: owner?.ownerPlayerId ?? null,
      controllerPlayerId: controller?.controllerPlayerId ?? null,
      objectiveType: objective?.type ?? null,
      objectiveState: objective?.state ?? null,
    });
  }
  return entities;
}
