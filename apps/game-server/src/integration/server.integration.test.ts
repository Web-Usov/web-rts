import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { FOUNDATION_MAP_HALF_EXTENT } from "@web-rts/game-data";
import {
  GAME_DATA_VERSION,
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
  MAX_PLAYERS,
  START_MESSAGE,
} from "../constants.js";
import { FoundationRoom } from "../rooms/foundation-room.js";
import { packageName } from "../index.js";

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
    expect(room.simulationHost).toBeNull();
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

    const points = room.slots.list().map((slot) => {
      const entityId = room.simulationHost!.primitiveUnits.getEntityId(slot.playerId);
      expect(entityId).toBeDefined();
      return room.simulationHost!.world.positions.get(entityId!);
    });
    expect(new Set(points.map((point) => `${point?.x},${point?.y}`)).size).toBe(MAX_PLAYERS);
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
    expect(room.simulationHost?.pendingCommandCount() ?? 0).toBe(0);
  });

  it("maps validated MOVE into SimulationCommand through SimulationHost", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: 77,
      mapId: "mapper-map",
    })) as FoundationRoom;
    const client = await colyseus.connectTo(room, compatibleOptions);

    expect(room.startMatch()).toBe(true);
    expect(room.phase).toBe("RUNNING");
    expect(room.simulationHost).not.toBeNull();
    expect(room.simulationHost?.seed).toBe(77);
    expect(room.simulationHost?.mapId).toBe("mapper-map");

    const unitId = room.simulationHost!.primitiveUnits.getEntityId(0)!;
    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    client.send(
      COMMAND_MESSAGE,
      createMove({ commandId: "mapped-1", clientSequence: 42, entityIds: [unitId] }),
    );
    await waitServer;

    const host = room.simulationHost!;
    if (host.pendingCommandCount() > 0) {
      host.step();
    }
    expect(host.pendingCommandCount()).toBe(0);
    expect(host.tick).toBeGreaterThanOrEqual(1);
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
    expect(room.simulationHost?.seed).toBe(5);
    expect(room.simulationHost?.mapId).toBe("start-map");
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
    const unitId = room.simulationHost!.primitiveUnits.getEntityId(
      room.slots.getBySessionId(clientB.sessionId)!.playerId,
    )!;
    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    clientB.send(COMMAND_MESSAGE, createMove({ commandId: "after-leave", entityIds: [unitId] }));
    await waitServer;

    const host = room.simulationHost!;
    if (host.pendingCommandCount() > 0) {
      host.step();
    }
    expect(host.tick).toBeGreaterThanOrEqual(1);
  });

  it("replicates authoritative MOVE movement to both clients", async () => {
    const room = (await colyseus.createRoom(FOUNDATION_ROOM_NAME, {
      ...compatibleOptions,
      seed: 3,
    })) as FoundationRoom;
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);

    room.startMatch();
    const host = room.simulationHost!;
    const playerA = room.slots.getBySessionId(clientA.sessionId)!.playerId;
    const unitA = host.primitiveUnits.getEntityId(playerA)!;
    const start = host.world.positions.get(unitA)!;
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

    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    clientA.send(
      COMMAND_MESSAGE,
      createMove({
        commandId: "move-e2e",
        entityIds: [unitA],
        target,
      }),
    );
    await waitServer;

    while (host.pendingCommandCount() > 0 || host.world.movements.has(unitA)) {
      host.step();
    }
    room.broadcastState();

    const [viewA, viewB] = await Promise.all([waitA, waitB]);
    const entityA = viewA.entities.find((e) => e.entityId === unitA)!;
    const entityB = viewB.entities.find((e) => e.entityId === unitA)!;
    expect(entityA.x).toBeCloseTo(entityB.x, 5);
    expect(entityA.y).toBeCloseTo(entityB.y, 5);
    expect(entityA.x).toBeCloseTo(target.x, 5);
    expect(viewA.localPlayerId).toBe(playerA);
    expect(viewB.localPlayerId).not.toBe(viewA.localPlayerId);
    expect(host.primitiveUnits.size).toBe(2);

    const objectivesA = viewA.entities.filter((entity) => entity.kind === "objective");
    const objectivesB = viewB.entities.filter((entity) => entity.kind === "objective");
    expect(objectivesA).toHaveLength(1);
    expect(objectivesB).toEqual(objectivesA);
    expect(objectivesA[0]).toMatchObject({
      x: 0,
      y: 0,
      objectiveType: "SACRED_SITE",
      objectiveState: "ACTIVE",
      ownerPlayerId: null,
      controllerPlayerId: null,
    });
    expect(entityA).toMatchObject({
      ownerPlayerId: playerA,
      controllerPlayerId: playerA,
      kind: "unit",
    });
  });

  it("rejects out-of-bounds MOVE and foreign-unit MOVE without crashing", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);
    room.startMatch();

    const host = room.simulationHost!;
    const playerA = room.slots.getBySessionId(clientA.sessionId)!.playerId;
    const playerB = room.slots.getBySessionId(clientB.sessionId)!.playerId;
    const unitA = host.primitiveUnits.getEntityId(playerA)!;
    const unitB = host.primitiveUnits.getEntityId(playerB)!;

    const oob = clientA.waitForMessage(EVENT_MESSAGE);
    clientA.send(
      COMMAND_MESSAGE,
      createMove({
        commandId: "oob",
        entityIds: [unitA],
        target: { x: FOUNDATION_MAP_HALF_EXTENT + 5, y: 0 },
      }),
    );
    expect(await oob).toMatchObject({ type: "COMMAND_REJECTED", reason: "out_of_bounds" });

    const foreign = clientA.waitForMessage(EVENT_MESSAGE);
    clientA.send(
      COMMAND_MESSAGE,
      createMove({
        commandId: "foreign",
        entityIds: [unitB],
        target: { x: 1, y: 1 },
      }),
    );
    expect(await foreign).toMatchObject({ type: "COMMAND_REJECTED", reason: "not_your_unit" });

    const objectiveId = host.world
      .entityIds()
      .find((entityId) => host.world.objectives.has(entityId));
    expect(objectiveId).toBeDefined();
    const objectiveMove = clientA.waitForMessage(EVENT_MESSAGE);
    clientA.send(
      COMMAND_MESSAGE,
      createMove({
        commandId: "objective",
        entityIds: [objectiveId!],
        target: { x: 1, y: 1 },
      }),
    );
    expect(await objectiveMove).toMatchObject({
      type: "COMMAND_REJECTED",
      reason: "not_your_unit",
    });
    expect(host.world.positions.get(objectiveId!)).toEqual({ x: 0, y: 0 });

    expect(room.phase).toBe("RUNNING");
    expect(host.pendingCommandCount()).toBe(0);
    expect(room.clients.length).toBe(2);
  });
});
