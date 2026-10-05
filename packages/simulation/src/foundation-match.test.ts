import { describe, expect, it } from "vitest";
import { foundationUnitSpawnPosition } from "@web-rts/game-data";
import { placeFoundationObjective, spawnFoundationUnits } from "./foundation-match.js";
import { readWorldEntities } from "./snapshot.js";
import { createWorld } from "./world.js";

describe("foundation match layout", () => {
  it("spawns one controlled unit per player and one Sacred Site", () => {
    const world = createWorld({ seed: 1 });
    const units = spawnFoundationUnits(world, [0]);
    const objectiveId = placeFoundationObjective(world);
    const unitId = units.get(0);

    expect(unitId).toBeDefined();
    expect(world.positions.get(unitId!)).toEqual(foundationUnitSpawnPosition(0));
    expect(world.controllers.get(unitId!)).toEqual({ controllerPlayerId: 0 });
    expect(world.owners.get(unitId!)).toEqual({ ownerPlayerId: 0 });
    expect(world.positions.get(objectiveId)).toEqual({ x: 0, y: 0 });
    expect(world.objectives.get(objectiveId)).toEqual({ type: "SACRED_SITE", state: "ACTIVE" });
    expect(world.controllers.has(objectiveId)).toBe(false);
  });

  it("assigns distinct spawns when player ids are not 0..3", () => {
    const world = createWorld({ seed: 1 });
    const units = spawnFoundationUnits(world, [0, 2, 3, 4]);
    const points = [0, 2, 3, 4].map((playerId) => world.positions.get(units.get(playerId)!));
    expect(new Set(points.map((point) => `${point?.x},${point?.y}`)).size).toBe(4);
  });

  it("reads plain entity snapshots without component stores", () => {
    const world = createWorld({ seed: 1 });
    const units = spawnFoundationUnits(world, [0]);
    placeFoundationObjective(world);

    const entities = readWorldEntities(world);
    expect(entities.find((entity) => entity.kind === "unit")).toEqual({
      entityId: units.get(0),
      kind: "unit",
      ...foundationUnitSpawnPosition(0),
      ownerPlayerId: 0,
      controllerPlayerId: 0,
      objectiveType: null,
      objectiveState: null,
    });
    expect(entities.find((entity) => entity.kind === "objective")).toMatchObject({
      kind: "objective",
      x: 0,
      y: 0,
      ownerPlayerId: null,
      controllerPlayerId: null,
      objectiveType: "SACRED_SITE",
      objectiveState: "ACTIVE",
    });
    expect(readWorldEntities(world)[0]).not.toBe(entities[0]);
  });
});
