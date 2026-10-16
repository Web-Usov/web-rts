import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@web-rts/game-data", () => {
  it("exports package name", () => {
    expect(packageName).toBe("@web-rts/game-data");
  });
});

it("declares only Wall/Tower construction, with Wood costs, tick durations; only Tower has automatic combat", async () => {
  const { ENTITY_DEFINITIONS, getEntityDefinition } = await import("./entity-definitions.js");
  for (const id of ["wall", "tower"]) {
    const definition = getEntityDefinition(id)!;
    expect(definition.kind).toBe("BUILDING");
    expect(definition.footprint).toEqual({
      width: 1,
      height: 1,
      blocksMovement: true,
      blocksBuilding: true,
    });
    expect(definition.maxHealth).toBeGreaterThan(0);
    expect(definition.construction!.woodCost).toBeGreaterThan(0);
    expect(Number.isInteger(definition.construction!.durationTicks)).toBe(true);
    if (definition.id === "wall") expect(definition.attack).toBeUndefined();
    else expect(definition.attack?.range).toBeGreaterThan(0);
  }
  expect(ENTITY_DEFINITIONS.worker.worker.builder).toBe(true);
  expect(getEntityDefinition("town_hall")!.construction).toBeUndefined();
});
