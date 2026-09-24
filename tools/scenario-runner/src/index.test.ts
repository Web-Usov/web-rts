import { describe, expect, it } from "vitest";
import type { World } from "@web-rts/simulation";
import { runScenario, spawnUnit } from "@web-rts/testkit";
import { scenarioRunnerName } from "./index.js";

function movementScenario(): {
  seed: number;
  defaultMoveSpeed: number;
  ticks: number;
  setup: (world: World) => void;
  commands: Parameters<typeof runScenario>[0]["commands"];
} {
  return {
    seed: 77,
    defaultMoveSpeed: 5,
    ticks: 15,
    setup: (world) => {
      spawnUnit(world, { x: 1, y: 1 });
    },
    commands: [
      {
        atTick: 0,
        command: {
          type: "MOVE",
          commandId: "a",
          entityIds: [1],
          target: { x: 4, y: 5 },
        },
      },
      {
        atTick: 5,
        command: {
          type: "MOVE",
          commandId: "b",
          entityIds: [1],
          target: { x: 0, y: 0 },
        },
      },
    ],
  };
}

describe("@web-rts/scenario-runner", () => {
  it("identifies the scenario runner package", () => {
    expect(scenarioRunnerName).toBe("@web-rts/scenario-runner");
  });

  it("moves a unit without browser or server", () => {
    const world = runScenario({
      seed: 100,
      defaultMoveSpeed: 5,
      ticks: 10,
      setup: (w) => {
        spawnUnit(w, { x: 0, y: 0 });
      },
      commands: [
        {
          atTick: 0,
          command: {
            type: "MOVE",
            commandId: "scenario-move",
            entityIds: [1],
            target: { x: 5, y: 0 },
          },
        },
      ],
    });

    expect(world.positions.get(1)).toEqual({ x: 5, y: 0 });
    expect(world.movements.has(1)).toBe(false);
  });

  it("applies scheduled commands only on tick boundaries", () => {
    const world = runScenario({
      seed: 2,
      defaultMoveSpeed: 5,
      ticks: 1,
      setup: (w) => {
        spawnUnit(w, { x: 0, y: 0 });
      },
      commands: [
        {
          atTick: 0,
          command: {
            type: "MOVE",
            commandId: "boundary",
            entityIds: [1],
            target: { x: 10, y: 0 },
          },
        },
      ],
    });

    const events = world.drainEvents();
    expect(events).toContainEqual({
      type: "COMMAND_APPLIED",
      commandId: "boundary",
      tick: 0,
    });
    expect(world.positions.get(1)?.x).toBeCloseTo(0.5, 10);
  });

  it("repeats the same scenario result for the same seed and commands", () => {
    const options = movementScenario();
    const first = runScenario(options);
    const second = runScenario(options);

    expect(first.positions.get(1)).toEqual(second.positions.get(1));
    expect(first.tick).toBe(second.tick);
  });
});
