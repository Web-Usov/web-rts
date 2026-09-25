import { describe, expect, it } from "vitest";
import {
  FOUNDATION_MAP_BOUNDS,
  FOUNDATION_MAP_HALF_EXTENT,
  foundationUnitSpawnPosition,
  isWithinFoundationBounds,
} from "./foundation-map.js";

describe("foundation map bounds", () => {
  it("accepts points inside the playable square", () => {
    expect(isWithinFoundationBounds({ x: 0, y: 0 })).toBe(true);
    expect(
      isWithinFoundationBounds({
        x: FOUNDATION_MAP_HALF_EXTENT,
        y: -FOUNDATION_MAP_HALF_EXTENT,
      }),
    ).toBe(true);
  });

  it("rejects out-of-bounds and non-finite targets", () => {
    expect(isWithinFoundationBounds({ x: FOUNDATION_MAP_HALF_EXTENT + 0.1, y: 0 })).toBe(false);
    expect(isWithinFoundationBounds({ x: 0, y: -FOUNDATION_MAP_HALF_EXTENT - 1 })).toBe(false);
    expect(isWithinFoundationBounds({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isWithinFoundationBounds({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("exposes stable AABB constants", () => {
    expect(FOUNDATION_MAP_BOUNDS).toEqual({
      minX: -20,
      maxX: 20,
      minY: -20,
      maxY: 20,
    });
  });
});

describe("foundation unit spawn positions", () => {
  it("does not wrap a later playerId onto the first spawn slot", () => {
    expect(() => foundationUnitSpawnPosition(4)).toThrow(RangeError);
  });

  it("returns distinct positions for the first four player slots", () => {
    const positions = [0, 1, 2, 3].map((id) => foundationUnitSpawnPosition(id));
    const keys = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(4);
    for (const point of positions) {
      expect(isWithinFoundationBounds(point)).toBe(true);
    }
  });
});
