import type { EntityId, ObjectiveState, ObjectiveType } from "./types.js";
import type { World } from "./world.js";

/**
 * Transport-neutral entity read. match-adapter projects it into GameStateView.
 * It is not a wire DTO and does not import protocol.
 */
export type MatchEntitySnapshot = {
  entityId: EntityId;
  kind: "unit" | "objective";
  x: number;
  y: number;
  ownerPlayerId: number | null;
  controllerPlayerId: number | null;
  objectiveType: ObjectiveType | null;
  objectiveState: ObjectiveState | null;
};

/**
 * Fresh plain objects on every call. Entities without a position are omitted.
 * Component stores are not exposed.
 */
export function readWorldEntities(world: World): MatchEntitySnapshot[] {
  const entities: MatchEntitySnapshot[] = [];
  for (const entityId of world.entityIds()) {
    const position = world.positions.get(entityId);
    if (position === undefined) {
      continue;
    }
    const objective = world.objectives.get(entityId);
    const owner = world.owners.get(entityId);
    const controller = world.controllers.get(entityId);
    entities.push({
      entityId,
      kind: objective === undefined ? "unit" : "objective",
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
