import { describe, expect, it } from "vitest";
import { foundationUnitSpawnPosition } from "@web-rts/game-data";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type GameEvent,
  type GameStateView,
} from "@web-rts/protocol";
import { createLocalMatchRuntime, type LocalTickSchedule } from "./local-match-runtime.js";
import { LOCAL_PLAYER_ID, LOCAL_ROOM_ID, type MainToWorkerMessage } from "./local-protocol.js";

function harness(): {
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
  const runtime = createLocalMatchRuntime((message) => {
    if (message.type === "state") {
      states.push(message.state);
    } else if (message.type === "event") {
      events.push(message.event);
    }
  }, schedule);

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

  it("forwards command rejections and ignores a stale session", () => {
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
});
