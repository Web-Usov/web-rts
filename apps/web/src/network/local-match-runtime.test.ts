import { describe, expect, it } from "vitest";
import { foundationUnitSpawnPosition } from "@web-rts/game-data";
import {
  GAME_DATA_VERSION,
  MAX_COMMAND_ID_LENGTH,
  MAX_MOVE_ENTITY_IDS,
  PROTOCOL_VERSION,
  type GameEvent,
  type GameStateView,
} from "@web-rts/protocol";
import { createMatchRuntime, type MatchRuntime, type MatchSetup } from "@web-rts/simulation";
import {
  FOUNDATION_PARITY_FIXTURE,
  PARITY_FINISH_AFTER_STEPS,
  createFinishingMatchRuntime,
  normalizeGameStateView,
  runParityReference,
} from "@web-rts/testkit";
import { createLocalMatchRuntime, type LocalTickSchedule } from "./local-match-runtime.js";
import { LOCAL_PLAYER_ID, LOCAL_ROOM_ID, type MainToWorkerMessage } from "./local-protocol.js";

function harness(createRuntime?: (setup: MatchSetup) => MatchRuntime): {
  states: GameStateView[];
  events: GameEvent[];
  tick: () => void;
  cancelCount: () => number;
  handle: (message: MainToWorkerMessage) => void;
} {
  const states: GameStateView[] = [];
  const events: GameEvent[] = [];
  let scheduled: (() => void) | null = null;
  let cancels = 0;
  const schedule: LocalTickSchedule = (tick) => {
    scheduled = tick;
    return () => {
      cancels += 1;
      scheduled = null;
    };
  };
  const runtime = createLocalMatchRuntime(
    (message) => {
      if (message.type === "state") {
        states.push(message.state);
      } else if (message.type === "event") {
        events.push(message.event);
      }
    },
    schedule,
    createRuntime ? { createRuntime } : {},
  );

  return {
    states,
    events,
    tick() {
      scheduled?.();
    },
    cancelCount: () => cancels,
    handle: (message) => {
      runtime.handle(message);
    },
  };
}

const connectMessage = {
  type: "connect",
  sessionId: 1,
  protocolVersion: PROTOCOL_VERSION,
  gameDataVersion: GAME_DATA_VERSION,
  seed: 1,
  mapId: "foundation",
} as const;

describe("local match runtime", () => {
  it("runs a shared MOVE from lobby through the worker simulation", () => {
    const match = harness();
    match.handle(connectMessage);
    expect(match.states.at(-1)).toMatchObject({
      roomId: LOCAL_ROOM_ID,
      phase: "LOBBY",
      localPlayerId: LOCAL_PLAYER_ID,
      players: [{ playerId: 0, connected: true }],
      entities: [],
    });

    match.handle({ type: "start", sessionId: 1 });
    const running = match.states.at(-1);
    expect(running?.phase).toBe("RUNNING");
    expect(running?.players).toEqual([{ playerId: 0, connected: true }]);
    const unit = running?.entities.find((entity) => entity.kind === "unit");
    const objective = running?.entities.find((entity) => entity.kind === "objective");
    expect(unit).toMatchObject({
      ...foundationUnitSpawnPosition(0),
      ownerPlayerId: 0,
      controllerPlayerId: 0,
      objectiveType: null,
    });
    expect(objective).toMatchObject({
      x: 0,
      y: 0,
      kind: "objective",
      objectiveType: "SACRED_SITE",
      objectiveState: "ACTIVE",
      controllerPlayerId: null,
    });

    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "move-1",
        clientSequence: 1,
        entityIds: [unit!.entityId],
        target: { x: 4, y: -3 },
      },
    });
    match.tick();

    const moved = match.states
      .at(-1)
      ?.entities.find((entity) => entity.entityId === unit!.entityId);
    expect(moved?.x).not.toBe(foundationUnitSpawnPosition(0).x);
    expect(match.states.at(-1)?.tick).toBe(1);
    expect(
      objective && match.states.at(-1)?.entities.find((entity) => entity.kind === "objective"),
    ).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it("forwards shell and tick-boundary rejections and ignores a stale session", () => {
    const match = harness();
    match.handle(connectMessage);
    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "too-soon",
        clientSequence: 1,
        entityIds: [1],
        target: { x: 0, y: 0 },
      },
    });
    expect(match.events).toEqual([
      { type: "COMMAND_REJECTED", commandId: "too-soon", reason: "not_running" },
    ]);

    match.handle({ type: "start", sessionId: 1 });
    const unitId = match.states.at(-1)?.entities.find((entity) => entity.kind === "unit")?.entityId;
    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "oob",
        clientSequence: 2,
        entityIds: [unitId!],
        target: { x: 100, y: 0 },
      },
    });
    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "foreign",
        clientSequence: 3,
        entityIds: [999],
        target: { x: 1, y: 1 },
      },
    });
    expect(match.events).toHaveLength(1);
    match.tick();
    match.handle({
      type: "command",
      sessionId: 1,
      command: { type: "MOVE", commandId: "bad" },
    });
    match.handle({
      type: "command",
      sessionId: 4,
      command: {
        type: "MOVE",
        commandId: "stale",
        clientSequence: 4,
        entityIds: [unitId!],
        target: { x: 1, y: 1 },
      },
    });

    expect(match.events.map((event) => ("reason" in event ? event.reason : event.type))).toEqual([
      "not_running",
      "out_of_bounds",
      "not_your_unit",
      "invalid_schema",
    ]);

    match.handle({ type: "start", sessionId: 1 });
    expect(match.events.at(-1)).toEqual({
      type: "COMMAND_REJECTED",
      commandId: "start",
      reason: "invalid_phase",
    });
  });

  it("rejects oversized payloads as invalid_schema without echoing an oversized commandId", () => {
    const match = harness();
    match.handle(connectMessage);
    match.handle({ type: "start", sessionId: 1 });
    const move = {
      type: "MOVE",
      commandId: "ok-id",
      clientSequence: 1,
      entityIds: [1],
      target: { x: 1, y: 1 },
    };

    expect(() => {
      match.handle({
        type: "command",
        sessionId: 1,
        command: { ...move, commandId: "x".repeat(MAX_COMMAND_ID_LENGTH * 1000) },
      });
      match.handle({
        type: "command",
        sessionId: 1,
        command: { ...move, entityIds: Array.from({ length: MAX_MOVE_ENTITY_IDS + 1 }, () => 1) },
      });
      match.handle({
        type: "command",
        sessionId: 1,
        command: { ...move, target: { x: Number.POSITIVE_INFINITY, y: 0 } },
      });
    }).not.toThrow();

    expect(match.events).toEqual([
      { type: "COMMAND_REJECTED", commandId: "unknown", reason: "invalid_schema" },
      { type: "COMMAND_REJECTED", commandId: "ok-id", reason: "invalid_schema" },
      { type: "COMMAND_REJECTED", commandId: "ok-id", reason: "invalid_schema" },
    ]);
    expect(match.states.at(-1)?.phase).toBe("RUNNING");
  });

  it("bounds the Local pending queue and answers overflow with queue_full", () => {
    const match = harness((setup) => createMatchRuntime(setup, { maxPendingCommandsPerPlayer: 2 }));
    match.handle(connectMessage);
    match.handle({ type: "start", sessionId: 1 });
    const unitId = match.states.at(-1)!.entities.find((entity) => entity.kind === "unit")!.entityId;
    for (const commandId of ["q1", "q2", "q3"]) {
      match.handle({
        type: "command",
        sessionId: 1,
        command: {
          type: "MOVE",
          commandId,
          clientSequence: 1,
          entityIds: [unitId],
          target: { x: 3, y: 3 },
        },
      });
    }
    expect(match.events).toEqual([
      { type: "COMMAND_REJECTED", commandId: "q3", reason: "queue_full" },
    ]);

    match.tick();
    // Queued commands were not evicted: they applied and freed the queue.
    expect(match.events).toHaveLength(1);
    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "q4",
        clientSequence: 2,
        entityIds: [unitId],
        target: { x: 3, y: 3 },
      },
    });
    expect(match.events).toHaveLength(1);
  });

  it("stops the tick schedule on disconnect", () => {
    const match = harness();
    match.handle(connectMessage);
    match.handle({ type: "start", sessionId: 1 });
    match.handle({ type: "disconnect", sessionId: 1 });
    expect(match.cancelCount()).toBe(1);
    match.tick();
    expect(match.states.at(-1)?.phase).toBe("RUNNING");
    expect(match.states.at(-1)?.tick).toBe(0);
  });

  it("rejects a protocol mismatch without opening a match", () => {
    const match = harness();
    const failed: string[] = [];
    const runtime = createLocalMatchRuntime(
      (message) => {
        if (message.type === "event") {
          match.events.push(message.event);
        }
        if (message.type === "failed") {
          failed.push(message.message);
        }
        if (message.type === "state") {
          match.states.push(message.state);
        }
      },
      () => () => {},
    );

    runtime.handle({ ...connectMessage, protocolVersion: PROTOCOL_VERSION + 1 });
    expect(failed).toEqual(["protocol_mismatch"]);
    expect(match.events[0]).toMatchObject({ type: "PROTOCOL_MISMATCH" });
    expect(match.states).toEqual([]);
    runtime.handle({ type: "start", sessionId: 1 });
    expect(match.states).toEqual([]);
  });

  it("delivers a simulation rejection after the tick, not on submit", () => {
    const match = harness();
    match.handle(connectMessage);
    match.handle({ type: "start", sessionId: 1 });
    const objectiveId = match.states
      .at(-1)
      ?.entities.find((entity) => entity.kind === "objective")?.entityId;
    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "objective",
        clientSequence: 1,
        entityIds: [objectiveId!],
        target: { x: 1, y: 1 },
      },
    });
    expect(match.events).toEqual([]);
    match.tick();
    expect(match.events).toEqual([
      { type: "COMMAND_REJECTED", commandId: "objective", reason: "not_your_unit" },
    ]);
  });

  it("matches the shared parity reference for the same fixture", () => {
    const fixture = FOUNDATION_PARITY_FIXTURE;
    const match = harness();
    match.handle({ ...connectMessage, seed: fixture.seed, mapId: fixture.mapId });
    match.handle({ type: "start", sessionId: 1 });
    for (let tick = 0; tick < fixture.ticks; tick += 1) {
      for (const step of fixture.steps.filter((candidate) => candidate.atTick === tick)) {
        match.handle({ type: "command", sessionId: 1, command: step.payload });
      }
      match.tick();
    }

    const reference = runParityReference(fixture);
    const rejections = match.events.flatMap((event) =>
      event.type === "COMMAND_REJECTED"
        ? [{ commandId: event.commandId, reason: event.reason }]
        : [],
    );
    expect(rejections).toEqual(fixture.expectedRejections);
    expect(rejections).toEqual(reference.rejections);
    expect(normalizeGameStateView(match.states.at(-1)!)).toEqual(reference.finalView);
  });

  it("reflects START → RUNNING → FINISHED and rejects commands after FINISHED", () => {
    const match = harness((setup) => createFinishingMatchRuntime(setup));
    match.handle(connectMessage);
    match.handle({ type: "start", sessionId: 1 });
    expect(match.states.map((state) => state.phase)).toEqual(["LOBBY", "RUNNING"]);

    for (let tick = 0; tick < PARITY_FINISH_AFTER_STEPS; tick += 1) {
      match.tick();
    }
    const final = match.states.at(-1)!;
    expect(final).toMatchObject({ phase: "FINISHED", tick: PARITY_FINISH_AFTER_STEPS });
    expect(final.entities.length).toBeGreaterThan(0);
    expect(match.cancelCount()).toBe(1);

    match.handle({
      type: "command",
      sessionId: 1,
      command: {
        type: "MOVE",
        commandId: "after-finish",
        clientSequence: 1,
        entityIds: [1],
        target: { x: 1, y: 1 },
      },
    });
    expect(match.events.at(-1)).toEqual({
      type: "COMMAND_REJECTED",
      commandId: "after-finish",
      reason: "not_running",
    });
    match.handle({ type: "start", sessionId: 1 });
    expect(match.events.at(-1)).toMatchObject({ commandId: "start", reason: "invalid_phase" });
  });
});
