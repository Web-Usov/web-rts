import { getEntityDefinition, type EntityDefinition, type MapDefinition } from "@web-rts/game-data";
import type { EntityId } from "./types.js";
import type { World } from "./world.js";

// Match layout from the declarative MapDefinition. Called only by MatchRuntime
// bootstrap, so Local and Remote cannot diverge.

const PLAYER_UNIT_DEFINITION_ID = "foundation_unit";

/**
 * One controllable unit per player, indexed by spawn slot among the players
 * present at Start (not by historical playerId). Returns playerId → entityId.
 */
export function spawnPlayerUnits(
  world: World,
  map: MapDefinition,
  playerIds: readonly number[],
): Map<number, EntityId> {
  const definition = requireDefinition(PLAYER_UNIT_DEFINITION_ID);
  const byPlayer = new Map<number, EntityId>();
  const ordered = [...new Set(playerIds)].sort((left, right) => left - right);
  ordered.forEach((playerId, spawnIndex) => {
    const spawn = map.playerSpawns[spawnIndex];
    if (spawn === undefined) {
      throw new RangeError(`map ${map.id} has no spawn slot ${spawnIndex}`);
    }
    const entityId = world.createEntity({ kind: definition.kind, definitionId: definition.id });
    world.positions.set(entityId, { x: spawn.unitPosition.x, y: spawn.unitPosition.y });
    world.owners.set(entityId, { ownerPlayerId: playerId });
    world.controllers.set(entityId, { controllerPlayerId: playerId });
    byPlayer.set(playerId, entityId);
  });
  return byPlayer;
}

/**
 * Starting footprint entities (Sacred Site in #002). Each gets a solid footprint
 * and, when the map declares one, a generic objective role. No Owner/Controller.
 */
export function placeStartingStructures(world: World, map: MapDefinition): EntityId[] {
  const grid = world.grid;
  if (grid === null) {
    throw new Error("starting structures require a world grid");
  }
  return map.startingPlacements.map((placement) => {
    const definition = requireDefinition(placement.definitionId);
    if (definition.footprint === null) {
      throw new RangeError(`placement ${placement.definitionId} has no footprint`);
    }
    const footprint = { anchorCell: placement.anchorCell, ...definition.footprint };
    const entityId = world.createEntity({ kind: definition.kind, definitionId: definition.id });
    world.positions.set(entityId, grid.footprintWorldCenter(footprint));
    const placed = world.placeSolidFootprint(entityId, footprint);
    if (!placed.ok) {
      throw new RangeError(`placement ${placement.definitionId} rejected: ${placed.reason}`);
    }
    if (placement.objective !== null) {
      world.addObjective({
        type: placement.objective.type,
        targetEntityId: entityId,
        required: placement.objective.required,
        state: "ACTIVE",
      });
    }
    return entityId;
  });
}

function requireDefinition(definitionId: string): EntityDefinition {
  const definition = getEntityDefinition(definitionId);
  if (definition === undefined) {
    throw new RangeError(`unknown entity definition ${definitionId}`);
  }
  return definition;
}
