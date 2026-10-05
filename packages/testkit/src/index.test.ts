import { describe, expect, it } from "vitest";
import {
  FOUNDATION_PARITY_FIXTURE,
  TEST_PLAYER_ID,
  createTestWorld,
  PARITY_FINISH_AFTER_STEPS,
  createFinishingMatchRuntime,
  normalizeGameStateView,
  runParityReference,
  runScenario,
  spawnUnit,
} from "./index.js";

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

  it("spawns units owned and controlled by the test player", () => {
    const world = createTestWorld();
    const entityId = spawnUnit(world, { x: 1, y: 2 });
    expect(world.owners.get(entityId)).toEqual({ ownerPlayerId: TEST_PLAYER_ID });
    expect(world.controllers.get(entityId)).toEqual({ controllerPlayerId: TEST_PLAYER_ID });
  });

  it("passes the scenario actor to tick-boundary validation", () => {
    const world = runScenario({
      ticks: 1,
      setup: (w) => {
        spawnUnit(w, { x: 0, y: 0 });
      },
      commands: [
        {
          atTick: 0,
          actor: { playerId: 3 },
          command: { type: "MOVE", commandId: "foreign", entityIds: [1], target: { x: 1, y: 0 } },
        },
      ],
    });
    expect(world.positions.get(1)).toEqual({ x: 0, y: 0 });
    expect(world.drainEvents()).toContainEqual({
      type: "COMMAND_REJECTED",
      commandId: "foreign",
      playerId: 3,
      reason: "not_your_unit",
      tick: 0,
    });
  });

  it("normalizes shell metadata out of GameStateView", () => {
    expect(
      FOUNDATION_PARITY_FIXTURE.steps.every(
        (step) => step.atTick < FOUNDATION_PARITY_FIXTURE.ticks,
      ),
    ).toBe(true);
    const normalized = normalizeGameStateView({
      protocolVersion: 1,
      gameDataVersion: "0.0.0",
      roomId: "local",
      tick: 3,
      phase: "RUNNING",
      localPlayerId: 0,
      players: [{ playerId: 0, connected: true }],
      entities: [],
    });
    expect(normalized).not.toHaveProperty("roomId");
    expect(normalized).not.toHaveProperty("players");
    expect(normalized.tick).toBe(3);
  });

  it("runs the parity fixture through the shared runtime and adapter", () => {
    const outcome = runParityReference(FOUNDATION_PARITY_FIXTURE);
    expect(outcome.rejections).toEqual(FOUNDATION_PARITY_FIXTURE.expectedRejections);
    expect(outcome.finalView.tick).toBe(FOUNDATION_PARITY_FIXTURE.ticks);
    const unit = outcome.finalView.entities.find((entity) => entity.entityId === 1);
    expect(unit).toMatchObject({ kind: "unit", ownerPlayerId: 0, controllerPlayerId: 0 });
    expect(unit?.x).not.toBe(-6);
    expect(runParityReference(FOUNDATION_PARITY_FIXTURE)).toEqual(outcome);
  });

  it("finishes the substitute runtime after the configured steps", () => {
    const runtime = createFinishingMatchRuntime({
      seed: 1,
      mapId: "foundation",
      participants: [{ playerId: 0 }],
    });
    for (let step = 0; step < PARITY_FINISH_AFTER_STEPS + 2; step += 1) {
      runtime.step();
    }
    expect(runtime.status).toBe("FINISHED");
    expect(runtime.readSnapshot()).toMatchObject({
      tick: PARITY_FINISH_AFTER_STEPS,
      status: "FINISHED",
    });
    expect(
      runtime.submitCommand(
        { playerId: 0 },
        { type: "MOVE", commandId: "late", entityIds: [1], target: { x: 0, y: 0 } },
      ),
    ).toEqual({ accepted: false, reason: "not_running" });
  });
});
