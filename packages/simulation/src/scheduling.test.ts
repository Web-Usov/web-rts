import { describe, expect, it } from "vitest";
import { scheduleCommands, commandPathCost } from "./command-scheduler.js";
import { EntityPathQueryLane } from "./path-query-lane.js";
import { resolveSimulationConfig } from "./config.js";
import { createMatchRuntime, resolveRuntimeConfig } from "./match-runtime.js";

const intent = (commandId: string, cost = 1) => ({
  type: "MOVE" as const,
  commandId,
  entityIds: Array<number>(cost).fill(999),
  target: { x: 0, y: 0 },
});

describe("fair command scheduling", () => {
  it.each([2, 3, 4])(
    "round-robins %i players independently of insertion order and preserves FIFO",
    (count) => {
      const queues = new Map(
        Array.from({ length: count }, (_, i) => count - 1 - i).map((id) => [
          id,
          [`${id}a`, `${id}b`],
        ]),
      );
      const result = scheduleCommands(queues, undefined, 20, 20, () => 1);
      expect(result.selected.map((x) => x.command)).toEqual(
        ["a", "b"].flatMap((suffix) => Array.from({ length: count }, (_, id) => `${id}${suffix}`)),
      );
    },
  );
  it("rotates scarce-budget first priority and resolves a removed cursor to its successor", () => {
    const queues = new Map([
      [2, ["a", "b", "c"]],
      [4, ["d", "e", "f"]],
      [6, ["g", "h", "i"]],
    ]);
    const first = scheduleCommands(queues, undefined, 1, 1, () => 1);
    expect(first.selected[0]!.playerId).toBe(2);
    queues.delete(4);
    const next = scheduleCommands(queues, first.nextPlayerId, 1, 1, () => 1);
    expect(next.selected[0]!.playerId).toBe(6);
    expect(next.nextPlayerId).toBe(2);
    expect(scheduleCommands(queues, 7, 1, 1, () => 1).selected[0]!.playerId).toBe(2);
    expect(scheduleCommands(new Map(), 2, 1, 1, () => 1).nextPlayerId).toBeUndefined();
  });
  it("skips an unfitting head without bypassing it while a smaller peer fits", () => {
    const queues = new Map([
      [0, [intent("first", 3)]],
      [1, [intent("large", 3), intent("later", 1)]],
      [2, [intent("small", 1)]],
    ]);
    const result = scheduleCommands(queues, undefined, 10, 4, commandPathCost);
    expect(result.selected.map((x) => x.command.commandId)).toEqual(["first", "small"]);
    expect(result.reservedCost).toBe(4);
    expect(queues.get(1)!.map((x) => x.commandId)).toEqual(["large", "later"]);
  });
  it("reserves the future cost contracts, bounds zero-cost work even with no path budget", () => {
    for (const type of ["BUILD", "GATHER", "GARRISON"] as const)
      expect(commandPathCost({ type })).toBe(1);
    expect(commandPathCost({ type: "UNGARRISON" })).toBe(0);
    const queues = new Map([[0, Array(20).fill({ type: "UNGARRISON" as const })]]);
    expect(scheduleCommands(queues, undefined, 3, 0, commandPathCost).selected).toHaveLength(3);
    expect(queues.get(0)).toHaveLength(17);
  });
  it("bounds rejected commands, never refunds semantic rejection, and prevents spam starvation", () => {
    const runtime = createMatchRuntime(
      { seed: 1, mapId: "foundation", participants: [{ playerId: 0 }, { playerId: 1 }] },
      { maxCommandsPerTick: 1 },
    );
    for (let i = 0; i < 20; i++) runtime.submitCommand({ playerId: 0 }, intent(`spam-${i}`, 16));
    runtime.submitCommand({ playerId: 1 }, intent("peer"));
    runtime.step();
    expect(runtime.readMetrics()).toMatchObject({
      processedCommands: 1,
      reservedCommandPathCost: 16,
      commandBudgetRemaining: 0,
      activeTaskQueries: 0,
      aiQueries: 0,
    });
    expect(runtime.drainEvents().map((x) => x.commandId)).toEqual(["spam-0"]);
    runtime.step();
    expect(runtime.drainEvents().map((x) => x.commandId)).toEqual(["peer"]);
    expect(runtime.readMetrics().processedCommands).toBe(1);
    runtime.removePlayer(0);
    expect(runtime.readMetrics().pendingCommandCount).toBe(0);
  });
  it("a semantic rejection consumes reservation so later commands wait", () => {
    const runtime = createMatchRuntime({
      seed: 1,
      mapId: "foundation",
      participants: [{ playerId: 0 }],
    });
    runtime.submitCommand({ playerId: 0 }, intent("bad", 16));
    runtime.submitCommand({ playerId: 0 }, intent("later"));
    runtime.step();
    expect(runtime.drainEvents().map((x) => x.commandId)).toEqual(["bad"]);
    expect(runtime.readMetrics()).toMatchObject({
      pendingCommandCount: 1,
      reservedCommandPathCost: 16,
    });
  });
  it("repeats blocked group MOVE and gives another player a turn next tick", () => {
    const run = (order: number[]) => {
      const runtime = createMatchRuntime({
        seed: 1,
        mapId: "foundation",
        participants: [{ playerId: 0 }, { playerId: 1 }],
      });
      const units = runtime.readSnapshot().entities.filter((x) => x.kind === "UNIT");
      for (const id of order)
        runtime.submitCommand(
          { playerId: id },
          { ...intent(`group-${id}`, 16), entityIds: Array<number>(16).fill(units[id]!.entityId) },
        );
      runtime.step();
      expect(runtime.readMetrics()).toMatchObject({
        processedCommands: 1,
        reservedCommandPathCost: 16,
        pendingCommandCount: 1,
      });
      runtime.step();
      expect(runtime.readMetrics().pendingCommandCount).toBe(0);
      expect(runtime.drainEvents()).toEqual([]);
      return runtime.readSnapshot();
    };
    expect(run([1, 0])).toEqual(run([0, 1]));
  });
});

describe("configuration", () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsupported integer %s",
    (value) => {
      expect(() => resolveRuntimeConfig({ maxCommandsPerTick: value })).toThrow(RangeError);
      expect(() => resolveRuntimeConfig({ maxPendingCommandsPerPlayer: value })).toThrow(
        RangeError,
      );
      expect(() => resolveSimulationConfig({ maxPathQueriesPerTick: value })).toThrow(RangeError);
      for (const lane of ["commandBudget", "activeTaskBudget", "aiBudget"] as const)
        expect(() => resolveSimulationConfig({ pathQueriesPerTick: { [lane]: value } })).toThrow(
          RangeError,
        );
    },
  );
  it("enforces the total, including unsafe sum overflow", () => {
    expect(() => resolveSimulationConfig({ maxPathQueriesPerTick: 31 })).toThrow(RangeError);
    expect(() =>
      resolveSimulationConfig({
        maxPathQueriesPerTick: Number.MAX_SAFE_INTEGER,
        pathQueriesPerTick: { commandBudget: Number.MAX_SAFE_INTEGER },
      }),
    ).toThrow(RangeError);
    expect(resolveSimulationConfig().maxPathQueriesPerTick).toBe(32);
  });
});

describe("active-task / future AI policy", () => {
  it.each(["active-task", "AI"])(
    "%s allows one query per ascending entity per tick and no borrowing",
    () => {
      const lane = new EntityPathQueryLane(2);
      const other = new EntityPathQueryLane(8);
      expect(lane.tryReserve(1)).toBe(true);
      expect(lane.tryReserve(1)).toBe(false);
      expect(lane.tryReserve(2)).toBe(true);
      expect(lane.tryReserve(3)).toBe(false);
      expect(other.used).toBe(0);
      expect(lane.used).toBe(2);
      expect(() => lane.tryReserve(2)).toThrow(RangeError);
      expect(new EntityPathQueryLane(2).tryReserve(1)).toBe(true);
    },
  );
});
