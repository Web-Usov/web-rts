import { describe, expect, it } from "vitest";
import { createTestWorld, runScenario, spawnUnit } from "./index.js";

describe("@web-rts/testkit", () => {
  it("creates a seeded test world", () => {
    const world = createTestWorld({ seed: 9 });
    expect(world.config.seed).toBe(9);
    expect(world.tick).toBe(0);
  });

  it("runs a deterministic movement scenario", () => {
    const world = runScenario({
      seed: 11,
      defaultMoveSpeed: 5,
      ticks: 4,
      setup: (w) => {
        spawnUnit(w, { x: 0, y: 0 });
      },
      commands: [
        {
          atTick: 0,
          command: {
            type: "MOVE",
            commandId: "m1",
            entityIds: [1],
            target: { x: 2, y: 0 },
          },
        },
      ],
    });

    expect(world.tick).toBe(4);
    expect(world.positions.get(1)).toEqual({ x: 2, y: 0 });
  });
});
