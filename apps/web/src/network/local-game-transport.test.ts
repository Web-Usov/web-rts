import { describe, expect, it } from "vitest";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type GameStateView,
  type GameTransport,
} from "@web-rts/protocol";
import { LocalGameTransport, type LocalWorkerFactory } from "./local-game-transport.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./local-protocol.js";

const connectOptions = {
  protocolVersion: PROTOCOL_VERSION,
  gameDataVersion: GAME_DATA_VERSION,
  createRoom: true,
  seed: 1,
  mapId: "foundation",
};

type ScriptedPort = {
  sent: MainToWorkerMessage[];
  terminated: boolean;
  emit: (message: WorkerToMainMessage) => void;
};

function scriptedWorkers(): { factory: LocalWorkerFactory; ports: ScriptedPort[] } {
  const ports: ScriptedPort[] = [];
  const factory: LocalWorkerFactory = () => {
    let listener: (message: WorkerToMainMessage) => void = () => {};
    const port: ScriptedPort = {
      sent: [],
      terminated: false,
      emit(message) {
        listener(message);
      },
    };
    ports.push(port);
    return {
      postMessage(message) {
        port.sent.push(message);
      },
      terminate() {
        port.terminated = true;
      },
      setOnMessage(next) {
        listener = next;
      },
    };
  };
  return { factory, ports };
}

function sessionIdOf(message: MainToWorkerMessage | undefined): number {
  if (!message) {
    throw new Error("expected a worker message");
  }
  return message.sessionId;
}

describe("LocalGameTransport", () => {
  it("satisfies GameTransport and reports no resume or round trip", async () => {
    const { factory } = scriptedWorkers();
    const transport: GameTransport = new LocalGameTransport({ workerFactory: factory });
    expect(transport.readRoundTripMs()).toBeNull();
    await expect(transport.resumePreviousSession()).resolves.toEqual({ status: "absent" });
    expect(new LocalGameTransport({ workerFactory: factory }).hasResumeToken()).toBe(false);
  });

  it("bridges connect, state, and events for the active session", async () => {
    const { factory, ports } = scriptedWorkers();
    const transport = new LocalGameTransport({ workerFactory: factory });
    const states: GameStateView[] = [];
    const events: string[] = [];
    transport.subscribeState((state) => {
      states.push(state);
    });
    transport.subscribeEvent((event) => {
      events.push(event.type);
    });

    const pending = transport.connect(connectOptions);
    const sessionId = sessionIdOf(ports[0]?.sent[0]);
    expect(ports[0]?.sent[0]).toMatchObject({
      type: "connect",
      sessionId,
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      seed: 1,
      mapId: "foundation",
    });

    const lobby: GameStateView = {
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      roomId: "local",
      tick: 0,
      phase: "LOBBY",
      localPlayerId: 0,
      players: [{ playerId: 0, connected: true }],
      entities: [],
    };
    ports[0]?.emit({ type: "state", sessionId, state: lobby });
    ports[0]?.emit({ type: "connected", sessionId, roomId: "local" });
    await pending;

    expect(transport.connectedRoomId).toBe("local");
    expect(transport.readRoundTripMs()).toBeNull();
    expect(states).toEqual([lobby]);

    ports[0]?.emit({
      type: "event",
      sessionId,
      event: { type: "COMMAND_REJECTED", commandId: "cmd-1", reason: "not_running" },
    });
    expect(events).toEqual(["COMMAND_REJECTED"]);

    transport.startMatch();
    transport.sendCommand({
      type: "MOVE",
      commandId: "cmd-2",
      clientSequence: 1,
      entityIds: [1],
      target: { x: 2, y: 3 },
    });
    expect(ports[0]?.sent.map((message) => message.type)).toEqual(["connect", "start", "command"]);
  });

  it("drops malformed and stale worker messages", async () => {
    const { factory, ports } = scriptedWorkers();
    const transport = new LocalGameTransport({ workerFactory: factory });
    const states: GameStateView[] = [];
    transport.subscribeState((state) => {
      states.push(state);
    });

    const pending = transport.connect(connectOptions);
    const sessionId = sessionIdOf(ports[0]?.sent[0]);
    ports[0]?.emit({ type: "connected", sessionId, roomId: "local" });
    await pending;

    ports[0]?.emit({
      type: "state",
      sessionId,
      state: { roomId: "local" } as GameStateView,
    });
    ports[0]?.emit({
      type: "state",
      sessionId: sessionId + 99,
      state: {
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        roomId: "stale",
        tick: 4,
        phase: "RUNNING",
        localPlayerId: 0,
        players: [],
        entities: [],
      },
    });

    expect(states).toEqual([]);
  });

  it("disconnect terminates the worker, emits left, and ignores late messages", async () => {
    const { factory, ports } = scriptedWorkers();
    const transport = new LocalGameTransport({ workerFactory: factory });
    const notices: string[] = [];
    const states: string[] = [];
    transport.subscribeConnection((notice) => {
      notices.push(notice);
    });
    transport.subscribeState((state) => {
      states.push(state.roomId);
    });

    const pending = transport.connect(connectOptions);
    const sessionId = sessionIdOf(ports[0]?.sent[0]);
    ports[0]?.emit({ type: "connected", sessionId, roomId: "local" });
    await pending;

    await transport.disconnect();
    expect(notices).toEqual(["left"]);
    expect(transport.connectedRoomId).toBeNull();
    expect(ports[0]?.terminated).toBe(true);
    expect(ports[0]?.sent.at(-1)).toMatchObject({ type: "disconnect", sessionId });

    ports[0]?.emit({
      type: "state",
      sessionId,
      state: {
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        roomId: "local",
        tick: 1,
        phase: "RUNNING",
        localPlayerId: 0,
        players: [{ playerId: 0, connected: true }],
        entities: [],
      },
    });
    expect(states).toEqual([]);
    expect(transport.readRoundTripMs()).toBeNull();
  });

  it("ignores the previous worker after a new connect", async () => {
    const { factory, ports } = scriptedWorkers();
    const transport = new LocalGameTransport({ workerFactory: factory });
    const rooms: string[] = [];
    transport.subscribeState((state) => {
      rooms.push(state.roomId);
    });

    const first = transport.connect(connectOptions);
    const firstSession = sessionIdOf(ports[0]?.sent[0]);
    ports[0]?.emit({ type: "connected", sessionId: firstSession, roomId: "local" });
    await first;

    const second = transport.connect(connectOptions);
    expect(ports[0]?.terminated).toBe(true);
    const secondSession = sessionIdOf(ports[1]?.sent[0]);
    expect(secondSession).not.toBe(firstSession);

    ports[0]?.emit({
      type: "state",
      sessionId: firstSession,
      state: {
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        roomId: "old",
        tick: 1,
        phase: "RUNNING",
        localPlayerId: 0,
        players: [],
        entities: [],
      },
    });
    ports[1]?.emit({ type: "connected", sessionId: secondSession, roomId: "local" });
    await second;
    expect(rooms).toEqual([]);
    expect(transport.connectedRoomId).toBe("local");
  });

  it("does not post commands before a session exists and still emits left", async () => {
    const { factory, ports } = scriptedWorkers();
    const transport = new LocalGameTransport({ workerFactory: factory });
    const notices: string[] = [];
    transport.subscribeConnection((notice) => {
      notices.push(notice);
    });
    transport.sendCommand({
      type: "MOVE",
      commandId: "early",
      clientSequence: 0,
      entityIds: [1],
      target: { x: 0, y: 0 },
    });
    transport.startMatch();
    expect(ports).toHaveLength(0);

    await transport.disconnect();
    expect(notices).toEqual(["left"]);
    await expect(transport.resumePreviousSession({ endpoint: "http://ignored" })).resolves.toEqual({
      status: "absent",
    });
  });
});
