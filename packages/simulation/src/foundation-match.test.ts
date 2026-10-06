import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP, type MapDefinition } from "@web-rts/game-data";
import { placeStartingStructures, spawnPlayerUnits } from "./foundation-match.js";
import { readWorldEntities } from "./snapshot.js";
import { createWorld } from "./world.js";

describe("match layout from MapDefinition", () => {
  it("spawns one controlled unit per player and a Sacred Site with a PROTECT objective", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const units = spawnPlayerUnits(world, FOUNDATION_MAP, [0]);
    const [siteId] = placeStartingStructures(world, FOUNDATION_MAP);
    const unitId = units.get(0);

    expect(unitId).toBeDefined();
    expect(world.identities.get(unitId!)).toEqual({
      kind: "UNIT",
      definitionId: "foundation_unit",
    });
    expect(world.positions.get(unitId!)).toEqual(FOUNDATION_MAP.playerSpawns[0]!.unitPosition);
    expect(world.controllers.get(unitId!)).toEqual({ controllerPlayerId: 0 });
    expect(world.owners.get(unitId!)).toEqual({ ownerPlayerId: 0 });

    expect(world.identities.get(siteId!)).toEqual({
      kind: "OBJECTIVE",
      definitionId: "sacred_site",
    });
    expect(world.positions.get(siteId!)).toEqual({ x: 0, y: 0 });
    expect(world.controllers.has(siteId!)).toBe(false);
    expect(world.owners.has(siteId!)).toBe(false);
    expect(world.objectiveEntries()).toEqual([
      [1, { type: "PROTECT", targetEntityId: siteId, required: true, state: "ACTIVE" }],
    ]);
  });

  it("registers the Sacred Site 2×2 footprint as solid occupancy", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const [siteId] = placeStartingStructures(world, FOUNDATION_MAP);
    const grid = world.grid!;

    expect(world.topologyRevision).toBe(1);
    for (const cell of [
      { x: 19, y: 19 },
      { x: 20, y: 19 },
      { x: 19, y: 20 },
      { x: 20, y: 20 },
    ]) {
      expect(grid.occupantAt(cell)).toBe(siteId);
      expect(grid.isWalkable(cell)).toBe(false);
      expect(grid.isBuildable(cell)).toBe(false);
    }
    expect(grid.occupantAt({ x: 21, y: 20 })).toBeNull();
    expect(grid.worldToCell({ x: 0, y: 0 })).toEqual({ x: 20, y: 20 });
  });

  it("assigns distinct spawns when player ids are not 0..3", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const units = spawnPlayerUnits(world, FOUNDATION_MAP, [0, 2, 3, 4]);
    const points = [0, 2, 3, 4].map((playerId) => world.positions.get(units.get(playerId)!));
    expect(new Set(points.map((point) => `${point?.x},${point?.y}`)).size).toBe(4);
  });

  it("does not wrap a fifth player onto the first spawn slot", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    expect(() => spawnPlayerUnits(world, FOUNDATION_MAP, [0, 1, 2, 3, 4])).toThrow(RangeError);
  });

  it("rejects a starting placement that overlaps static non-buildable terrain", () => {
    const blocked: MapDefinition = {
      ...FOUNDATION_MAP,
      staticTerrain: [{ x: 20, y: 20, width: 1, height: 1, walkable: false, buildable: false }],
    };
    const world = createWorld({ seed: 1, map: blocked });
    expect(() => placeStartingStructures(world, blocked)).toThrow(/terrain/);
  });

  it("reads plain entity snapshots with explicit kind and definitionId", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const units = spawnPlayerUnits(world, FOUNDATION_MAP, [0]);
    placeStartingStructures(world, FOUNDATION_MAP);

    const entities = readWorldEntities(world);
    expect(entities.find((entity) => entity.kind === "UNIT")).toEqual({
      entityId: units.get(0),
      kind: "UNIT",
      definitionId: "foundation_unit",
      ...FOUNDATION_MAP.playerSpawns[0]!.unitPosition,
      ownerPlayerId: 0,
      controllerPlayerId: 0,
      objectiveType: null,
      objectiveState: null,
    });
    expect(entities.find((entity) => entity.kind === "OBJECTIVE")).toMatchObject({
      kind: "OBJECTIVE",
      definitionId: "sacred_site",
      x: 0,
      y: 0,
      ownerPlayerId: null,
      controllerPlayerId: null,
      objectiveType: "PROTECT",
      objectiveState: "ACTIVE",
    });
    expect(readWorldEntities(world)[0]).not.toBe(entities[0]);
  });
});
