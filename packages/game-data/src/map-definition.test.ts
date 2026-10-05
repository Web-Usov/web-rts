import { describe, expect, it } from "vitest";
import { ENTITY_KINDS, getEntityDefinition } from "./entity-definitions.js";
import {
  FOUNDATION_MAP,
  FOUNDATION_MAP_ID,
  getMapDefinition,
  mapWorldBounds,
  type CellRect,
} from "./map-definition.js";

function rectInsideMap(rect: CellRect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= FOUNDATION_MAP.widthCells &&
    rect.y + rect.height <= FOUNDATION_MAP.heightCells
  );
}

describe("foundation MapDefinition", () => {
  it("is registered under its mapId", () => {
    expect(getMapDefinition(FOUNDATION_MAP_ID)).toBe(FOUNDATION_MAP);
    expect(getMapDefinition("unknown")).toBeUndefined();
  });

  it("derives half-open world bounds from origin and cell counts", () => {
    expect(mapWorldBounds(FOUNDATION_MAP)).toEqual({ minX: -20, maxX: 20, minY: -20, maxY: 20 });
  });

  it("keeps spawn unit positions inside their spawn regions and the map", () => {
    expect(FOUNDATION_MAP.playerSpawns).toHaveLength(4);
    const keys = new Set<string>();
    for (const spawn of FOUNDATION_MAP.playerSpawns) {
      expect(rectInsideMap(spawn.region)).toBe(true);
      const cellX = Math.floor(spawn.unitPosition.x - FOUNDATION_MAP.originX);
      const cellY = Math.floor(spawn.unitPosition.y - FOUNDATION_MAP.originY);
      expect(cellX).toBeGreaterThanOrEqual(spawn.region.x);
      expect(cellX).toBeLessThan(spawn.region.x + spawn.region.width);
      expect(cellY).toBeGreaterThanOrEqual(spawn.region.y);
      expect(cellY).toBeLessThan(spawn.region.y + spawn.region.height);
      keys.add(`${spawn.unitPosition.x},${spawn.unitPosition.y}`);
    }
    expect(keys.size).toBe(4);
  });

  it("references only known footprint definitions in placements", () => {
    for (const placement of [
      ...FOUNDATION_MAP.startingPlacements,
      ...FOUNDATION_MAP.resourcePlacements,
    ]) {
      const definition = getEntityDefinition(placement.definitionId);
      expect(definition?.footprint).not.toBeNull();
      const footprint = definition!.footprint!;
      expect(
        rectInsideMap({
          ...placement.anchorCell,
          width: footprint.width,
          height: footprint.height,
        }),
      ).toBe(true);
    }
  });

  it("assigns a generic PROTECT objective to the sacred_site placement", () => {
    expect(FOUNDATION_MAP.startingPlacements).toEqual([
      {
        definitionId: "sacred_site",
        anchorCell: { x: 19, y: 19 },
        objective: { type: "PROTECT", required: true },
      },
    ]);
  });
});

describe("entity definitions", () => {
  it("use broad kinds and stable ids", () => {
    expect(ENTITY_KINDS).toEqual(["UNIT", "BUILDING", "RESOURCE", "OBJECTIVE"]);
    expect(getEntityDefinition("sacred_site")?.kind).toBe("OBJECTIVE");
    expect(getEntityDefinition("foundation_unit")).toEqual({
      id: "foundation_unit",
      kind: "UNIT",
      footprint: null,
    });
    expect(getEntityDefinition("toString")).toBeUndefined();
  });
});
