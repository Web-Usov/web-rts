import { describe, expect, it } from "vitest";
import { interpolateSnapshots, interpolationAlpha, type StateSnapshot } from "./interpolation.js";

function snap(tick: number, timeMs: number, entities: StateSnapshot["entities"]): StateSnapshot {
  return { tick, timeMs, entities };
}

describe("snapshot interpolation", () => {
  it("lerps positions between two authoritative snapshots", () => {
    const from = snap(1, 0, [
      {
        entityId: 1,
        x: 0,
        y: 0,
        kind: "unit",
        ownerPlayerId: 0,
        controllerPlayerId: 0,
      },
    ]);
    const to = snap(2, 100, [
      {
        entityId: 1,
        x: 10,
        y: 4,
        kind: "unit",
        ownerPlayerId: 0,
        controllerPlayerId: 0,
      },
    ]);

    expect(interpolateSnapshots(from, to, 0)[0]).toMatchObject({ x: 0, y: 0 });
    expect(interpolateSnapshots(from, to, 0.5)[0]).toMatchObject({ x: 5, y: 2 });
    expect(interpolateSnapshots(from, to, 1)[0]).toMatchObject({ x: 10, y: 4 });
  });

  it("computes alpha from explicit render time without wall-clock APIs", () => {
    const from = snap(1, 1000, []);
    const to = snap(2, 1100, []);
    expect(interpolationAlpha(from, to, 1000)).toBe(0);
    expect(interpolationAlpha(from, to, 1050)).toBe(0.5);
    expect(interpolationAlpha(from, to, 1100)).toBe(1);
    expect(interpolationAlpha(from, to, 1200)).toBe(1);
  });
});
