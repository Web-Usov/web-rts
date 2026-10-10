import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { FOUNDATION_MAP, mapWorldBounds } from "@web-rts/game-data";
import {
  GAME_DATA_VERSION,
  MAX_COMMAND_ID_LENGTH,
  MAX_MOVE_ENTITY_IDS,
  PROTOCOL_VERSION,
  STATE_MESSAGE,
  SYNC_MESSAGE,
  type GameStateView,
  type MoveCommand,
} from "@web-rts/protocol";
import { createGameServer } from "../app-config.js";
import {
  AUTH_ERROR_CODE,
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  FOUNDATION_ROOM_NAME,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  START_MESSAGE,
} from "../constants.js";
import { FoundationRoom } from "../rooms/foundation-room.js";
import { packageName } from "../index.js";
import { installRuntimeProbe } from "./runtime-probe.js";

const compatibleOptions = {
  protocolVersion: PROTOCOL_VERSION,
  gameDataVersion: GAME_DATA_VERSION,
};

function createMove(overrides: Partial<MoveCommand> = {}): MoveCommand {
  return {
    type: "MOVE",
    commandId: "move-1",
    clientSequence: 1,
    entityIds: [1],
    target: { x: 5, y: 6 },
    ...overrides,
  };
}

function isMatchMakeError(error: unknown): error is Error & { code: number; name: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "number"
  );
}

function runtimeOf(room: FoundationRoom) {
  expect(room.matchRuntime).not.toBeNull();
  return room.matchRuntime!;
}

function unitOf(room: FoundationRoom, playerId: number) {
  const unit = runtimeOf(room)
    .readSnapshot()
    .entities.find((entity) => entity.kind === "UNIT" && entity.ownerPlayerId === playerId);
  expect(unit).toBeDefined();
  return unit!;
}

function objectiveOf(room: FoundationRoom) {
  const objective = runtimeOf(room)
    .readSnapshot()
    .entities.find((entity) => entity.kind === "OBJECTIVE");
  expect(objective).toBeDefined();
  return objective!;
}

async function waitForState(
  client: { waitForMessage: (type: string) => Promise<unknown> },
  predicate: (view: GameStateView) => boolean,
  attempts = 40,
): Promise<GameStateView> {
  for (let i = 0; i < attempts; i += 1) {
    const payload = await client.waitForMessage(STATE_MESSAGE);
    const view = payload as GameStateView;
    if (predicate(view)) {
      return view;
    }
  }
  throw new Error("timed out waiting for matching GameStateView");
}

describe("game-server integration", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("exports package name", () => {
    expect(packageName).toBe("@web-rts/game-server");
  });

  it("responds on the health endpoint", async () => {
    const response = await colyseus.http.get("/health");
    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual({ status: "ok" });
  });

  it("creates a room and lets 2–4 headless clients join", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: 11,
      mapId: "test-map",
    })) as FoundationRoom;

    expect(room.roomId).toBeTruthy();
    expect(room.seed).toBe(11);
    expect(room.mapId).toBe("test-map");

    const clients = [];
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      clients.push(await colyseus.connectTo(room, compatibleOptions));
    }

    expect(room.clients.length).toBe(MAX_PLAYERS);
    expect(room.slots.size).toBe(MAX_PLAYERS);
    expect(clients.map((c) => c.sessionId).filter(Boolean)).toHaveLength(MAX_PLAYERS);
  });

  it("delivers the first lobby snapshot to a freshly connected client", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const client = await colyseus.connectTo(room, compatibleOptions);

    const pending = waitForState(
      client,
      (view) =>
        view.phase === "LOBBY" &&
        view.localPlayerId === 0 &&
        view.players.filter((player) => player.connected).length === 1 &&
        view.roomId === room.roomId,
    );
    client.send(SYNC_MESSAGE, {});

    const view = await pending;
    expect(view.entities).toEqual([]);
    expect(room.phase).toBe("LOBBY");
    expect(room.matchRuntime).toBeNull();
  });

  it("sends the same connected player list to every client after sync", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);

    const waitA = waitForState(
      clientA,
      (view) => view.players.filter((player) => player.connected).length === 2,
    );
    const waitB = waitForState(
      clientB,
      (view) => view.players.filter((player) => player.connected).length === 2,
    );
    clientA.send(SYNC_MESSAGE, {});
    clientB.send(SYNC_MESSAGE, {});

    const [viewA, viewB] = await Promise.all([waitA, waitB]);
    expect(viewA.players).toEqual(viewB.players);
    expect(viewA.localPlayerId).not.toBe(viewB.localPlayerId);
    expect(room.clients.length).toBe(2);
  });

  it("rejects the 5th client when the room is full", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;

    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      await colyseus.connectTo(room, compatibleOptions);
    }

    await expect(colyseus.connectTo(room, compatibleOptions)).rejects.toThrow();
    expect(room.clients.length).toBe(MAX_PLAYERS);
  });

  it("spawns unique positions after a non-zero player is replaced", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const clients = [];
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      clients.push(await colyseus.connectTo(room, compatibleOptions));
    }

    const leaving = clients[1];
    expect(room.slots.getBySessionId(leaving!.sessionId)?.playerId).toBe(1);
    await leaving!.leave();

    const replacement = await colyseus.connectTo(room, compatibleOptions);
    expect(room.slots.getBySessionId(replacement.sessionId)?.playerId).toBe(4);
    expect(room.startMatch()).toBe(true);

    const points = room.slots.list().map((slot) => unitOf(room, slot.playerId));
    expect(new Set(points.map((point) => `${point.x},${point.y}`)).size).toBe(MAX_PLAYERS);
  });

  it("frees a slot on leave so a new client can join a previously full room", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;

    const clients = [];
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      clients.push(await colyseus.connectTo(room, compatibleOptions));
    }
    expect(room.clients.length).toBe(MAX_PLAYERS);

    const leaving = clients[0];
    expect(leaving).toBeDefined();
    const leftSessionId = leaving!.sessionId;
    await leaving!.leave();

    expect(room.clients.length).toBe(MAX_PLAYERS - 1);
    expect(room.slots.getBySessionId(leftSessionId)).toBeUndefined();
    expect(room.slots.size).toBe(MAX_PLAYERS - 1);

    const replacement = await colyseus.connectTo(room, compatibleOptions);
    expect(replacement.sessionId).toBeTruthy();
    expect(room.clients.length).toBe(MAX_PLAYERS);
    expect(room.slots.size).toBe(MAX_PLAYERS);
  });

  it("rejects protocol version mismatch as auth error, not reconnect/shutdown code", async () => {
    const room = await colyseus.createRoom(FOUNDATION_ROOM_NAME, compatibleOptions);

    let caught: unknown;
    try {
      await colyseus.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION + 1,
        gameDataVersion: GAME_DATA_VERSION,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(isMatchMakeError(caught)).toBe(true);
    if (isMatchMakeError(caught)) {
      expect(caught.code).toBe(AUTH_ERROR_CODE);
      expect(caught.code).not.toBe(4010);
      expect(caught.code).not.toBe(4001);
      expect(caught.message).toContain("PROTOCOL_MISMATCH");
    }
  });

  it("rejects game-data version mismatch on join", async () => {
    const room = await colyseus.createRoom(FOUNDATION_ROOM_NAME, compatibleOptions);

    let caught: unknown;
    try {
      await colyseus.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: "9.9.9",
      });
    } catch (error) {
      caught = error;
    }

    expect(isMatchMakeError(caught)).toBe(true);
    if (isMatchMakeError(caught)) {
      expect(caught.code).toBe(AUTH_ERROR_CODE);
      expect(caught.message).toContain("PROTOCOL_MISMATCH");
    }
  });

  it("records simulation tick duration after the match starts", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    await colyseus.connectTo(room, compatibleOptions);
    expect(room.startMatch()).toBe(true);

    let diagnostic = room.lastTickDiagnostic;
    for (
      let attempt = 0;
      attempt < 40 && (diagnostic === null || diagnostic.tick < 1);
      attempt += 1
    ) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      diagnostic = room.lastTickDiagnostic;
    }

    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.tick).toBeGreaterThanOrEqual(1);
    expect(diagnostic?.durationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostic?.entityCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects malformed commands without crashing the room", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const client = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();

    const rejected = client.waitForMessage(EVENT_MESSAGE);
    client.send(COMMAND_MESSAGE, { type: "MOVE", broken: true });
    const event = await rejected;

    expect(event).toMatchObject({
      type: "COMMAND_REJECTED",
      reason: "invalid_schema",
    });
    expect(room.clients.length).toBe(1);
    expect(room.phase).toBe("RUNNING");
  });

  it("rejects identity spoofing via playerId in the command payload", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const client = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();

    const rejected = client.waitForMessage(EVENT_MESSAGE);
    client.send(COMMAND_MESSAGE, {
      ...createMove(),
      playerId: 999,
    });
    const event = await rejected;

    expect(event).toMatchObject({
      type: "COMMAND_REJECTED",
      reason: "invalid_schema",
    });
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(0);
  });

  it("creates the shared MatchRuntime from room seed/map and slot participants", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: 77,
      mapId: "mapper-map",
    })) as FoundationRoom;
    const probe = installRuntimeProbe(room, { held: true });
    const client = await colyseus.connectTo(room, compatibleOptions);

    expect(room.startMatch()).toBe(true);
    expect(room.phase).toBe("RUNNING");
    expect(probe.setups).toEqual([
      { seed: 77, mapId: "mapper-map", participants: [{ playerId: 0 }] },
    ]);

    const unitId = unitOf(room, 0).entityId;
    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    client.send(
      COMMAND_MESSAGE,
      createMove({ commandId: "mapped-1", clientSequence: 42, entityIds: [unitId] }),
    );
    await waitServer;
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(1);

    probe.allowSteps(1);
    await vi.waitFor(() => {
      expect(runtimeOf(room).readMetrics()).toMatchObject({ tick: 1, pendingCommandCount: 0 });
    });
  });

  it("starts simulation via client start message with seed/map", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: 5,
      mapId: "start-map",
    })) as FoundationRoom;
    const client = await colyseus.connectTo(room, compatibleOptions);

    const waitStart = room.waitForMessage(START_MESSAGE);
    client.send(START_MESSAGE, {});
    await waitStart;

    expect(room.phase).toBe("RUNNING");
    expect(room.matchRuntime).not.toBeNull();
    expect(room.metadata).toMatchObject({ phase: "RUNNING", seed: 5, mapId: "start-map" });
  });

  it("survives client leave without crashing the room/process", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);
    const leftSessionId = clientA.sessionId;

    await clientA.leave();
    expect(room.clients.length).toBe(1);
    expect(room.slots.getBySessionId(leftSessionId)).toBeUndefined();
    expect(room.slots.getBySessionId(clientB.sessionId)?.connected).toBe(true);

    room.startMatch();
    expect(room.phase).toBe("RUNNING");
    const unit = unitOf(room, room.slots.getBySessionId(clientB.sessionId)!.playerId);
    const moved = waitForState(clientB, (view) =>
      view.entities.some((entity) => entity.entityId === unit.entityId && entity.x !== unit.x),
    );
    clientB.send(
      COMMAND_MESSAGE,
      createMove({ commandId: "after-leave", entityIds: [unit.entityId] }),
    );
    expect((await moved).tick).toBeGreaterThanOrEqual(1);
  });

  it("replicates authoritative MOVE movement to both clients", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: 3,
    })) as FoundationRoom;
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);

    room.startMatch();
    const playerA = room.slots.getBySessionId(clientA.sessionId)!.playerId;
    const start = unitOf(room, playerA);
    const unitA = start.entityId;
    const target = { x: start.x + 2, y: start.y };

    const atTarget = (view: GameStateView): boolean => {
      const entity = view.entities.find((e) => e.entityId === unitA);
      return (
        entity !== undefined &&
        Math.abs(entity.x - target.x) < 1e-6 &&
        Math.abs(entity.y - target.y) < 1e-6
      );
    };
    const waitA = waitForState(clientA, atTarget);
    const waitB = waitForState(clientB, atTarget);

    clientA.send(
      COMMAND_MESSAGE,
      createMove({
        commandId: "move-e2e",
        entityIds: [unitA],
        target,
      }),
    );

    const [viewA, viewB] = await Promise.all([waitA, waitB]);
    const entityA = viewA.entities.find((e) => e.entityId === unitA)!;
    const entityB = viewB.entities.find((e) => e.entityId === unitA)!;
    expect(entityA.x).toBeCloseTo(entityB.x, 5);
    expect(entityA.y).toBeCloseTo(entityB.y, 5);
    expect(entityA.x).toBeCloseTo(target.x, 5);
    expect(viewA.localPlayerId).toBe(playerA);
    expect(viewB.localPlayerId).not.toBe(viewA.localPlayerId);
    expect(
      viewA.entities.filter((entity) => entity.definitionId === "foundation_unit"),
    ).toHaveLength(2);
    expect(viewA.entities.filter((entity) => entity.definitionId === "worker")).toHaveLength(2);

    const objectivesA = viewA.entities.filter((entity) => entity.kind === "OBJECTIVE");
    const objectivesB = viewB.entities.filter((entity) => entity.kind === "OBJECTIVE");
    expect(objectivesA).toHaveLength(1);
    expect(objectivesB).toEqual(objectivesA);
    expect(objectivesA[0]).toMatchObject({
      x: 0,
      y: 0,
      objectiveType: "PROTECT",
      objectiveState: "ACTIVE",
      ownerPlayerId: null,
      controllerPlayerId: null,
    });
    expect(entityA).toMatchObject({
      ownerPlayerId: playerA,
      controllerPlayerId: playerA,
      kind: "UNIT",
      definitionId: "foundation_unit",
    });
  });

  it("delivers simulation-generated COMMAND_REJECTED on the tick boundary", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const probe = installRuntimeProbe(room, { held: true });
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();

    const playerA = room.slots.getBySessionId(clientA.sessionId)!.playerId;
    const playerB = room.slots.getBySessionId(clientB.sessionId)!.playerId;
    const unitA = unitOf(room, playerA).entityId;
    const unitB = unitOf(room, playerB).entityId;
    const objective = objectiveOf(room);

    const received: unknown[] = [];
    const peerEvents: unknown[] = [];
    clientA.onMessage(EVENT_MESSAGE, (event) => received.push(event));
    clientB.onMessage(EVENT_MESSAGE, (event) => peerEvents.push(event));

    const moves = [
      createMove({
        commandId: "oob",
        entityIds: [unitA],
        target: { x: mapWorldBounds(FOUNDATION_MAP).maxX + 5, y: 0 },
      }),
      createMove({ commandId: "foreign", entityIds: [unitB], target: { x: 1, y: 1 } }),
      createMove({
        commandId: "objective",
        entityIds: [objective.entityId],
        target: { x: 1, y: 1 },
      }),
    ];
    for (const move of moves) {
      const waitServer = room.waitForMessage(COMMAND_MESSAGE);
      clientA.send(COMMAND_MESSAGE, move);
      await waitServer;
    }

    // Admission accepted all three; nothing is rejected before the tick.
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(3);
    expect(received).toEqual([]);

    probe.allowSteps(1);
    await vi.waitFor(() => {
      expect(received).toHaveLength(3);
    });
    expect(received).toEqual([
      { type: "COMMAND_REJECTED", commandId: "oob", reason: "out_of_bounds" },
      { type: "COMMAND_REJECTED", commandId: "foreign", reason: "not_your_unit" },
      { type: "COMMAND_REJECTED", commandId: "objective", reason: "not_your_unit" },
    ]);
    expect(peerEvents).toEqual([]);
    expect(objectiveOf(room)).toMatchObject({ x: 0, y: 0 });
    expect(room.phase).toBe("RUNNING");
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(0);
    expect(room.clients.length).toBe(2);
  });

  it("reads one runtime snapshot per broadcast for every recipient", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const probe = installRuntimeProbe(room, { held: true });
    const clients = [
      await colyseus.connectTo(room, compatibleOptions),
      await colyseus.connectTo(room, compatibleOptions),
      await colyseus.connectTo(room, compatibleOptions),
    ];
    room.startMatch();

    const before = probe.readSnapshotCalls;
    const views = clients.map((client) => client.waitForMessage(STATE_MESSAGE));
    room.broadcastState();
    expect(probe.readSnapshotCalls - before).toBe(1);
    const delivered = (await Promise.all(views)) as GameStateView[];
    expect(new Set(delivered.map((view) => view.localPlayerId)).size).toBe(3);

    probe.release();
    const ticksBefore = probe.stepCalls;
    const snapshotsBefore = probe.readSnapshotCalls;
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();
    const ticks = probe.stepCalls - ticksBefore;
    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(probe.readSnapshotCalls - snapshotsBefore).toBe(ticks);
  });

  it("rejects a new join after START and keeps the running match intact", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    await colyseus.connectTo(room, compatibleOptions);
    expect(room.locked).toBe(false);
    room.startMatch();
    expect(room.locked).toBe(true);

    await expect(colyseus.connectTo(room, compatibleOptions)).rejects.toThrow();
    expect(room.slots.size).toBe(1);
    expect(room.clients.length).toBe(1);
    expect(room.phase).toBe("RUNNING");
  });

  it("rejects a seat reserved in LOBBY that completes its join after START", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    await colyseus.connectTo(room, compatibleOptions);
    // Simulates the race lock() cannot close: the seat exists, onJoin runs later.
    room.phase = "RUNNING";
    await expect(colyseus.connectTo(room, compatibleOptions)).rejects.toThrow(/match_locked/);
    expect(room.slots.size).toBe(1);
  });

  it("rejects oversized commandId/entityIds and non-finite targets without crashing", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    installRuntimeProbe(room, { held: true });
    const client = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();

    const received: unknown[] = [];
    client.onMessage(EVENT_MESSAGE, (event) => received.push(event));
    const payloads: unknown[] = [
      createMove({ commandId: "x".repeat(MAX_COMMAND_ID_LENGTH + 1) }),
      createMove({
        commandId: "too-many",
        entityIds: Array.from({ length: MAX_MOVE_ENTITY_IDS + 1 }, (_, index) => index),
      }),
      createMove({ commandId: "huge-id", entityIds: [Number.MAX_SAFE_INTEGER] }),
      // JSON-like transports turn NaN/Infinity into null; msgpack keeps them.
      createMove({ commandId: "nan", target: { x: Number.NaN, y: 0 } }),
      createMove({ commandId: "inf", target: { x: 0, y: Number.POSITIVE_INFINITY } }),
    ];
    for (const payload of payloads) {
      const waitServer = room.waitForMessage(COMMAND_MESSAGE);
      client.send(COMMAND_MESSAGE, payload);
      await waitServer;
    }

    await vi.waitFor(() => {
      expect(received).toHaveLength(payloads.length);
    });
    expect(received).toEqual(
      ["unknown", "too-many", "huge-id", "nan", "inf"].map((commandId) => ({
        type: "COMMAND_REJECTED",
        commandId,
        reason: "invalid_schema",
      })),
    );
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(0);
    expect(room.clients.length).toBe(1);
    expect(room.phase).toBe("RUNNING");
  });

  it("drops a client whose frame exceeds the transport payload cap, not the room", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const sender = await colyseus.connectTo(room, compatibleOptions);
    const peer = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();
    sender.reconnection.enabled = false;

    // Colyseus WebSocketTransport closes frames above its 4 KiB maxPayload default.
    sender.send(COMMAND_MESSAGE, createMove({ commandId: "x".repeat(64 * 1024) }));

    await vi.waitFor(() => {
      expect(room.slots.getBySessionId(sender.sessionId)?.connected).toBe(false);
    });
    expect(room.phase).toBe("RUNNING");
    expect([...room.clients].map((client) => client.sessionId)).toEqual([peer.sessionId]);
  });

  it("bounds the Remote pending queue and answers overflow with queue_full", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const probe = installRuntimeProbe(room, {
      held: true,
      runtimeConfig: { maxPendingCommandsPerPlayer: 2 },
    });
    const client = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();
    const unit = unitOf(room, 0);

    const received: unknown[] = [];
    client.onMessage(EVENT_MESSAGE, (event) => received.push(event));
    for (const commandId of ["q1", "q2", "q3"]) {
      const waitServer = room.waitForMessage(COMMAND_MESSAGE);
      client.send(COMMAND_MESSAGE, createMove({ commandId, entityIds: [unit.entityId] }));
      await waitServer;
    }

    await vi.waitFor(() => {
      expect(received).toEqual([
        { type: "COMMAND_REJECTED", commandId: "q3", reason: "queue_full" },
      ]);
    });
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(2);

    probe.allowSteps(1);
    await vi.waitFor(() => {
      expect(runtimeOf(room).readMetrics()).toMatchObject({ tick: 1, pendingCommandCount: 0 });
    });
    expect(unitOf(room, 0).x).not.toBe(unit.x);
    expect(received).toHaveLength(1);
    expect(room.phase).toBe("RUNNING");
  });

  it("configures a finite message rate and disconnects a flooding client only", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    expect(room.maxMessagesPerSecond).toBe(MAX_CLIENT_MESSAGES_PER_SECOND);
    expect(Number.isFinite(room.maxMessagesPerSecond)).toBe(true);

    const probe = installRuntimeProbe(room, { held: true });
    const flooder = await colyseus.connectTo(room, compatibleOptions);
    const peer = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();
    const flooderSession = flooder.sessionId;
    flooder.reconnection.enabled = false;

    for (let index = 0; index < MAX_CLIENT_MESSAGES_PER_SECOND * 3; index += 1) {
      flooder.send(COMMAND_MESSAGE, { type: "MOVE", broken: index });
    }

    await vi.waitFor(() => {
      expect(room.slots.getBySessionId(flooderSession)?.connected).toBe(false);
    });
    expect(room.phase).toBe("RUNNING");
    expect([...room.clients].map((client) => client.sessionId)).toEqual([peer.sessionId]);

    const peerRejected = peer.waitForMessage(EVENT_MESSAGE);
    peer.send(COMMAND_MESSAGE, createMove({ commandId: "peer-ok", entityIds: [999] }));
    probe.allowSteps(1);
    await expect(peerRejected).resolves.toMatchObject({ commandId: "peer-ok" });
  });

  it("discards pending commands on consented leave and keeps Owner", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const probe = installRuntimeProbe(room, { held: true });
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();
    const playerA = room.slots.getBySessionId(clientA.sessionId)!.playerId;
    const unit = unitOf(room, playerA);

    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    clientA.send(COMMAND_MESSAGE, createMove({ commandId: "pending", entityIds: [unit.entityId] }));
    await waitServer;
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(1);

    await clientA.leave(true);
    await vi.waitFor(() => {
      expect(room.slots.getBySessionId(clientA.sessionId)).toBeUndefined();
    });
    expect(runtimeOf(room).readMetrics().pendingCommandCount).toBe(0);

    probe.allowSteps(2);
    await vi.waitFor(() => {
      expect(probe.appliedSteps).toBe(2);
    });
    expect(unitOf(room, playerA)).toMatchObject({
      x: unit.x,
      y: unit.y,
      ownerPlayerId: playerA,
      controllerPlayerId: null,
    });
    expect(runtimeOf(room).drainEvents()).toEqual([]);
  });
});
