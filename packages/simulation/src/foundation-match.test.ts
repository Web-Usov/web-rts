import { describe, expect, it } from "vitest";
import { foundationUnitSpawnPosition } from "@web-rts/game-data";
import {
  assessFoundationMove,
  placeFoundationObjective,
  spawnFoundationUnits,
} from "./foundation-match.js";
import { readWorldSnapshot } from "./snapshot.js";
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

  it("rejects a move that leaves the map or targets another controller", () => {
    const world = createWorld({ seed: 1 });
    const units = spawnFoundationUnits(world, [0, 1]);
    const own = units.get(0)!;
    const foreign = units.get(1)!;

    expect(assessFoundationMove(world, 0, [own], { x: 1, y: 1 })).toEqual({ ok: true });
    expect(assessFoundationMove(world, 0, [foreign], { x: 1, y: 1 })).toEqual({
      ok: false,
      reason: "not_your_unit",
    });
    expect(assessFoundationMove(world, 0, [own], { x: 100, y: 0 })).toEqual({
      ok: false,
      reason: "out_of_bounds",
    });
  });

  it("reads a plain snapshot without component stores", () => {
    const world = createWorld({ seed: 1 });
    const units = spawnFoundationUnits(world, [0]);
    placeFoundationObjective(world);

    const snapshot = readWorldSnapshot(world);
    expect(snapshot.tick).toBe(0);
    expect(snapshot).not.toHaveProperty("positions");
    expect(snapshot).not.toHaveProperty("movements");
    expect(snapshot.entities.find((entity) => entity.kind === "unit")).toEqual({
      entityId: units.get(0),
      kind: "unit",
      ...foundationUnitSpawnPosition(0),
      ownerPlayerId: 0,
      controllerPlayerId: 0,
      objectiveType: null,
      objectiveState: null,
    });
    expect(snapshot.entities.find((entity) => entity.kind === "objective")).toMatchObject({
      kind: "objective",
      x: 0,
      y: 0,
      ownerPlayerId: null,
      controllerPlayerId: null,
      objectiveType: "SACRED_SITE",
      objectiveState: "ACTIVE",
    });
  });
});
