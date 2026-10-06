import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP } from "@web-rts/game-data";
import type { SimulationCommand } from "./commands.js";
import {
  DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER,
  createMatchRuntime,
  resolveRuntimeConfig,
  type MatchRuntime,
  type MatchSnapshot,
} from "./match-runtime.js";

function move(commandId: string, entityIds: number[], target = { x: 2, y: 2 }): SimulationCommand {
  return { type: "MOVE", commandId, entityIds, target };
}

function unitOf(snapshot: MatchSnapshot, playerId: number) {
  const unit = snapshot.entities.find(
    (entity) => entity.kind === "UNIT" && entity.ownerPlayerId === playerId,
  );
  expect(unit).toBeDefined();
  return unit!;
}

function objectiveOf(snapshot: MatchSnapshot) {
  const objective = snapshot.entities.find((entity) => entity.kind === "OBJECTIVE");
  expect(objective).toBeDefined();
  return objective!;
}

function twoPlayerRuntime(): MatchRuntime {
  return createMatchRuntime({
    seed: 7,
    mapId: "foundation",
    participants: [{ playerId: 0 }, { playerId: 1 }],
  });
}

describe("MatchRuntime", () => {
  it("bootstraps the Foundation layout and starts RUNNING at tick 0", () => {
    const runtime = twoPlayerRuntime();
    const snapshot = runtime.readSnapshot();

    expect(runtime.status).toBe("RUNNING");
    expect(snapshot.tick).toBe(0);
    expect(snapshot.status).toBe("RUNNING");
    expect(unitOf(snapshot, 0)).toMatchObject({
      ...FOUNDATION_MAP.playerSpawns[0]!.unitPosition,
      controllerPlayerId: 0,
    });
    expect(unitOf(snapshot, 1)).toMatchObject({
      ...FOUNDATION_MAP.playerSpawns[1]!.unitPosition,
      controllerPlayerId: 1,
    });
    expect(objectiveOf(snapshot)).toMatchObject({ x: 0, y: 0, controllerPlayerId: null });
    expect(runtime.readMetrics()).toEqual({ tick: 0, entityCount: 3, pendingCommandCount: 0 });
    expect(runtime.drainEvents()).toEqual([]);
  });

  it("returns fresh plain snapshots without World internals", () => {
    const runtime = twoPlayerRuntime();
    const first = runtime.readSnapshot();
    const second = runtime.readSnapshot();
    expect(second).toEqual(first);
    expect(second.entities[0]).not.toBe(first.entities[0]);
    expect(Object.keys(first).sort()).toEqual(["entities", "status", "tick"]);
  });

  it("applies admitted commands on the next step, not on submit", () => {
    const runtime = twoPlayerRuntime();
    const unit = unitOf(runtime.readSnapshot(), 0);

    expect(runtime.submitCommand({ playerId: 0 }, move("m1", [unit.entityId]))).toEqual({
      accepted: true,
    });
    expect(runtime.readMetrics().pendingCommandCount).toBe(1);
    expect(unitOf(runtime.readSnapshot(), 0)).toMatchObject({ x: unit.x, y: unit.y });

    runtime.step();

    expect(runtime.readMetrics()).toEqual({ tick: 1, entityCount: 3, pendingCommandCount: 0 });
    expect(unitOf(runtime.readSnapshot(), 0).x).not.toBe(unit.x);
    expect(runtime.drainEvents()).toEqual([]);
  });

  it("turns simulation rejections into recipient-addressed runtime events", () => {
    const runtime = twoPlayerRuntime();
    const snapshot = runtime.readSnapshot();
    const foreign = unitOf(snapshot, 1);

    runtime.submitCommand({ playerId: 0 }, move("foreign", [foreign.entityId]));
    runtime.submitCommand(
      { playerId: 0 },
      move("oob", [unitOf(snapshot, 0).entityId], { x: 99, y: 0 }),
    );
    runtime.submitCommand({ playerId: 1 }, move("objective", [objectiveOf(snapshot).entityId]));
    runtime.step();

    expect(runtime.drainEvents()).toEqual([
      {
        type: "COMMAND_REJECTED",
        recipientPlayerId: 0,
        commandId: "foreign",
        reason: "not_your_unit",
        tick: 0,
      },
      {
        type: "COMMAND_REJECTED",
        recipientPlayerId: 0,
        commandId: "oob",
        reason: "out_of_bounds",
        tick: 0,
      },
      {
        type: "COMMAND_REJECTED",
        recipientPlayerId: 1,
        commandId: "objective",
        reason: "not_your_unit",
        tick: 0,
      },
    ]);
    expect(unitOf(runtime.readSnapshot(), 1)).toMatchObject({ x: foreign.x, y: foreign.y });
  });

  it("drains World events every step so applied/spawn events never accumulate", () => {
    const runtime = twoPlayerRuntime();
    const unitId = unitOf(runtime.readSnapshot(), 0).entityId;

    for (let tick = 0; tick < 20; tick += 1) {
      // South of the Sacred Site. (0, 0) is inside its solid footprint.
      runtime.submitCommand(
        { playerId: 0 },
        move(`ok-${tick}`, [unitId], { x: 4 + (tick % 3), y: -8 }),
      );
      runtime.step();
    }
    expect(runtime.drainEvents()).toEqual([]);

    runtime.submitCommand({ playerId: 0 }, move("late-bad", [999]));
    runtime.step();
    expect(runtime.drainEvents()).toEqual([
      {
        type: "COMMAND_REJECTED",
        recipientPlayerId: 0,
        commandId: "late-bad",
        reason: "not_your_unit",
        tick: 20,
      },
    ]);
    expect(runtime.drainEvents()).toEqual([]);
  });

  it("orders players by playerId regardless of submit order, FIFO within a player", () => {
    const runtime = twoPlayerRuntime();
    runtime.submitCommand({ playerId: 1 }, move("p1-a", [999]));
    runtime.submitCommand({ playerId: 0 }, move("p0-a", [999]));
    runtime.submitCommand({ playerId: 1 }, move("p1-b", [999]));
    runtime.submitCommand({ playerId: 0 }, move("p0-b", [999]));
    runtime.step();

    expect(runtime.drainEvents().map((event) => event.commandId)).toEqual([
      "p0-a",
      "p0-b",
      "p1-a",
      "p1-b",
    ]);
  });

  it("is deterministic for the same setup, commands, and ticks", () => {
    const run = (submitOrder: readonly number[]): MatchSnapshot => {
      const runtime = twoPlayerRuntime();
      const snapshot = runtime.readSnapshot();
      for (const playerId of submitOrder) {
        runtime.submitCommand(
          { playerId },
          move(`p${playerId}`, [unitOf(snapshot, playerId).entityId], { x: 3, y: -4 }),
        );
      }
      for (let tick = 0; tick < 15; tick += 1) {
        runtime.step();
      }
      return runtime.readSnapshot();
    };

    expect(run([0, 1])).toEqual(run([0, 1]));
    expect(run([1, 0])).toEqual(run([0, 1]));
  });

  it("rejects commands from players that are not participants", () => {
    const runtime = twoPlayerRuntime();
    expect(runtime.submitCommand({ playerId: 5 }, move("late-joiner", [1]))).toEqual({
      accepted: false,
      reason: "not_participant",
    });
    expect(runtime.readMetrics().pendingCommandCount).toBe(0);
  });

  it("bounds each player's pending queue with the default cap", () => {
    const runtime = twoPlayerRuntime();
    for (let index = 0; index < DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER; index += 1) {
      expect(runtime.submitCommand({ playerId: 0 }, move(`m${index}`, [1]))).toEqual({
        accepted: true,
      });
    }
    expect(runtime.submitCommand({ playerId: 0 }, move("overflow", [1]))).toEqual({
      accepted: false,
      reason: "queue_full",
    });
    expect(runtime.readMetrics().pendingCommandCount).toBe(DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER);
  });

  it("rejects overflow as queue_full without evicting queued commands or touching others", () => {
    const runtime = createMatchRuntime(
      { seed: 7, mapId: "foundation", participants: [{ playerId: 0 }, { playerId: 1 }] },
      { maxPendingCommandsPerPlayer: 2 },
    );
    const before = runtime.readSnapshot();
    const unit0 = unitOf(before, 0);
    const unit1 = unitOf(before, 1);

    expect(runtime.submitCommand({ playerId: 0 }, move("first", [unit0.entityId]))).toEqual({
      accepted: true,
    });
    expect(runtime.submitCommand({ playerId: 0 }, move("second", [999]))).toEqual({
      accepted: true,
    });
    expect(runtime.submitCommand({ playerId: 0 }, move("third", [unit0.entityId]))).toEqual({
      accepted: false,
      reason: "queue_full",
    });
    // Another player's queue is independent.
    expect(runtime.submitCommand({ playerId: 1 }, move("peer", [unit1.entityId]))).toEqual({
      accepted: true,
    });
    expect(runtime.readMetrics().pendingCommandCount).toBe(3);
    // queue_full is admission only: nothing was applied or emitted.
    expect(runtime.readSnapshot()).toEqual(before);
    expect(runtime.drainEvents()).toEqual([]);

    runtime.step();

    // The queued head and its successor ran; the rejected command never did.
    expect(unitOf(runtime.readSnapshot(), 0).x).not.toBe(unit0.x);
    expect(unitOf(runtime.readSnapshot(), 1).x).not.toBe(unit1.x);
    expect(runtime.drainEvents().map((event) => event.commandId)).toEqual(["second"]);
    expect(runtime.submitCommand({ playerId: 0 }, move("after-drain", [unit0.entityId]))).toEqual({
      accepted: true,
    });
  });

  it("requires a finite positive pending cap", () => {
    expect(resolveRuntimeConfig()).toEqual({
      maxPendingCommandsPerPlayer: DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER,
    });
    for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => resolveRuntimeConfig({ maxPendingCommandsPerPlayer: value })).toThrow(
        RangeError,
      );
    }
  });

  it("removePlayer discards pending commands, emits nothing, and releases Controller only", () => {
    const runtime = twoPlayerRuntime();
    const before = runtime.readSnapshot();
    const unit0 = unitOf(before, 0);
    const unit1 = unitOf(before, 1);

    runtime.submitCommand({ playerId: 0 }, move("pending-valid", [unit0.entityId]));
    runtime.submitCommand({ playerId: 0 }, move("pending-invalid", [unit1.entityId]));
    expect(runtime.readMetrics().pendingCommandCount).toBe(2);

    runtime.removePlayer(0);
    expect(runtime.readMetrics().pendingCommandCount).toBe(0);
    runtime.step();

    const after = runtime.readSnapshot();
    expect(runtime.drainEvents()).toEqual([]);
    expect(unitOf(after, 0)).toMatchObject({
      x: unit0.x,
      y: unit0.y,
      ownerPlayerId: 0,
      controllerPlayerId: null,
    });
    expect(unitOf(after, 1)).toMatchObject({ controllerPlayerId: 1 });
    expect(after.entities).toHaveLength(3);
    expect(runtime.submitCommand({ playerId: 0 }, move("after-leave", [unit0.entityId]))).toEqual({
      accepted: false,
      reason: "not_participant",
    });
  });

  it("drops undelivered events of a removed player", () => {
    const runtime = twoPlayerRuntime();
    runtime.submitCommand({ playerId: 0 }, move("bad-0", [999]));
    runtime.submitCommand({ playerId: 1 }, move("bad-1", [999]));
    runtime.step();
    runtime.removePlayer(0);
    expect(runtime.drainEvents().map((event) => event.recipientPlayerId)).toEqual([1]);
  });

  it("keeps the pending queue when the host does not remove the player (reconnect grace)", () => {
    const runtime = twoPlayerRuntime();
    const unit0 = unitOf(runtime.readSnapshot(), 0);
    runtime.submitCommand({ playerId: 0 }, move("during-grace", [unit0.entityId]));

    runtime.step();

    expect(unitOf(runtime.readSnapshot(), 0).x).not.toBe(unit0.x);
    expect(runtime.readMetrics().pendingCommandCount).toBe(0);
  });
});
