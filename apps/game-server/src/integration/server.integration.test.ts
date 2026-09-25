import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { GAME_DATA_VERSION, PROTOCOL_VERSION, type MoveCommand } from "@web-rts/protocol";
import { createGameServer } from "../app-config.js";
import {
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

  it("rejects protocol version mismatch on join", async () => {
    const room = await colyseus.createRoom(FOUNDATION_ROOM_NAME, compatibleOptions);

    await expect(
      colyseus.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION + 1,
        gameDataVersion: GAME_DATA_VERSION,
      }),
    ).rejects.toThrow();
  });

  it("rejects game-data version mismatch on join", async () => {
    const room = await colyseus.createRoom(FOUNDATION_ROOM_NAME, compatibleOptions);

    await expect(
      colyseus.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: "9.9.9",
      }),
    ).rejects.toThrow();
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

    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    client.send(COMMAND_MESSAGE, createMove({ commandId: "mapped-1", clientSequence: 42 }));
    await waitServer;

    expect(room.simulationHost?.pendingCommandCount()).toBe(1);

    // Drain via one tick: command applied; transport fields never entered simulation.
    room.simulationHost?.step();
    expect(room.simulationHost?.pendingCommandCount()).toBe(0);
    expect(room.simulationHost?.tick).toBe(1);
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

  it("survives client disconnect without crashing the room/process", async () => {
    const room = (await colyseus.createRoom(
      FOUNDATION_ROOM_NAME,
      compatibleOptions,
    )) as FoundationRoom;
    const clientA = await colyseus.connectTo(room, compatibleOptions);
    const clientB = await colyseus.connectTo(room, compatibleOptions);

    await clientA.leave();
    expect(room.clients.length).toBe(1);
    expect(room.slots.getBySessionId(clientA.sessionId)?.connected).toBe(false);
    expect(room.slots.getBySessionId(clientB.sessionId)?.connected).toBe(true);

    // Room remains usable after disconnect.
    room.startMatch();
    expect(room.phase).toBe("RUNNING");
    const waitServer = room.waitForMessage(COMMAND_MESSAGE);
    clientB.send(COMMAND_MESSAGE, createMove({ commandId: "after-disconnect" }));
    await waitServer;
    expect(room.simulationHost?.pendingCommandCount()).toBe(1);
  });
});
