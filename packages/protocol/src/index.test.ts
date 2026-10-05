import { describe, expect, it } from "vitest";
import {
  GAME_DATA_VERSION,
  MAX_COMMAND_ID_LENGTH,
  MAX_ENTITY_ID,
  MAX_MOVE_ENTITY_IDS,
  MAX_WORLD_COORDINATE_ABS,
  PROTOCOL_VERSION,
  UNKNOWN_COMMAND_ID,
  checkProtocolCompatibility,
  parseGameCommand,
  readRejectedCommandId,
  parseGameEvent,
  parseGameStateView,
  type ConnectOptions,
  type GameTransport,
  type MoveCommand,
} from "./index.js";

const validMove: MoveCommand = {
  type: "MOVE",
  commandId: "cmd-1",
  clientSequence: 0,
  entityIds: [1, 2],
  target: { x: 10.5, y: -3 },
};

describe("versions", () => {
  it("exports protocol and game-data versions for mismatch detection", () => {
    expect(PROTOCOL_VERSION).toBe(3);
    expect(GAME_DATA_VERSION).toBe("0.0.0");
  });

  it("detects compatible and incompatible handshakes", () => {
    expect(
      checkProtocolCompatibility({
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
      }).compatible,
    ).toBe(true);

    expect(
      checkProtocolCompatibility({
        protocolVersion: PROTOCOL_VERSION + 1,
        gameDataVersion: GAME_DATA_VERSION,
      }),
    ).toEqual({
      compatible: false,
      protocolMatch: false,
      gameDataMatch: true,
    });

    expect(
      checkProtocolCompatibility({
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: "9.9.9",
      }),
    ).toEqual({
      compatible: false,
      protocolMatch: true,
      gameDataMatch: false,
    });
  });
});

describe("parseGameCommand", () => {
  it("accepts a valid MOVE intent", () => {
    const result = parseGameCommand(validMove);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validMove);
    }
  });

  it("rejects MOVE that carries playerId (identity is session-derived)", () => {
    const result = parseGameCommand({
      ...validMove,
      playerId: 42,
    });
    expect(result.success).toBe(false);
  });

  it("rejects MOVE that carries authoritative position state", () => {
    const result = parseGameCommand({
      ...validMove,
      positions: [{ entityId: 1, x: 0, y: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields and bad types without throwing", () => {
    expect(() => parseGameCommand({})).not.toThrow();
    expect(parseGameCommand({}).success).toBe(false);
    expect(parseGameCommand(null).success).toBe(false);
    expect(
      parseGameCommand({
        type: "MOVE",
        commandId: "",
        clientSequence: -1,
        entityIds: [],
        target: { x: Number.NaN, y: 1 },
      }).success,
    ).toBe(false);
    expect(
      parseGameCommand({
        type: "ATTACK",
        commandId: "x",
        clientSequence: 0,
        entityIds: [1],
        target: { x: 0, y: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("command ingress bounds", () => {
  it("accepts payloads exactly at the limits", () => {
    const result = parseGameCommand({
      ...validMove,
      commandId: "c".repeat(MAX_COMMAND_ID_LENGTH),
      entityIds: Array.from({ length: MAX_MOVE_ENTITY_IDS }, (_, index) => index),
      target: { x: MAX_WORLD_COORDINATE_ABS, y: -MAX_WORLD_COORDINATE_ABS },
    });
    expect(result.success).toBe(true);
    expect(parseGameCommand({ ...validMove, entityIds: [MAX_ENTITY_ID] }).success).toBe(true);
  });

  it("rejects an oversized or out-of-domain commandId", () => {
    expect(
      parseGameCommand({ ...validMove, commandId: "c".repeat(MAX_COMMAND_ID_LENGTH + 1) }).success,
    ).toBe(false);
    expect(parseGameCommand({ ...validMove, commandId: "has space" }).success).toBe(false);
    expect(parseGameCommand({ ...validMove, commandId: "line\nbreak" }).success).toBe(false);
    expect(parseGameCommand({ ...validMove, commandId: "кириллица" }).success).toBe(false);
  });

  it("rejects an oversized entityIds array without throwing", () => {
    const huge = Array.from({ length: 100_000 }, (_, index) => index);
    expect(() => parseGameCommand({ ...validMove, entityIds: huge })).not.toThrow();
    expect(parseGameCommand({ ...validMove, entityIds: huge }).success).toBe(false);
    expect(
      parseGameCommand({
        ...validMove,
        entityIds: Array.from({ length: MAX_MOVE_ENTITY_IDS + 1 }, () => 1),
      }).success,
    ).toBe(false);
  });

  it("rejects entity ids outside the identifier domain", () => {
    for (const entityId of [MAX_ENTITY_ID + 1, -1, 1.5, Number.NaN, "1"]) {
      expect(parseGameCommand({ ...validMove, entityIds: [entityId] }).success).toBe(false);
    }
  });

  it("rejects non-finite and out-of-domain coordinates", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      MAX_WORLD_COORDINATE_ABS + 1,
      -MAX_WORLD_COORDINATE_ABS - 1,
    ]) {
      expect(parseGameCommand({ ...validMove, target: { x: value, y: 0 } }).success).toBe(false);
      expect(parseGameCommand({ ...validMove, target: { x: 0, y: value } }).success).toBe(false);
    }
    expect(parseGameCommand({ ...validMove, target: { x: 0, y: 0, z: 1 } }).success).toBe(false);
  });

  it("rejects a non-safe-integer clientSequence", () => {
    expect(
      parseGameCommand({ ...validMove, clientSequence: Number.MAX_SAFE_INTEGER + 2 }).success,
    ).toBe(false);
  });

  it("echoes only an in-domain commandId for a rejected payload", () => {
    expect(readRejectedCommandId({ commandId: "cmd-7", broken: true })).toBe("cmd-7");
    expect(readRejectedCommandId({ commandId: "c".repeat(MAX_COMMAND_ID_LENGTH + 1) })).toBe(
      UNKNOWN_COMMAND_ID,
    );
    expect(readRejectedCommandId({ commandId: 42 })).toBe(UNKNOWN_COMMAND_ID);
    expect(readRejectedCommandId(null)).toBe(UNKNOWN_COMMAND_ID);
    expect(readRejectedCommandId("MOVE")).toBe(UNKNOWN_COMMAND_ID);
  });
});

describe("parseGameEvent / parseGameStateView", () => {
  it("accepts COMMAND_REJECTED and PROTOCOL_MISMATCH events", () => {
    const rejected = parseGameEvent({
      type: "COMMAND_REJECTED",
      commandId: "cmd-1",
      reason: "not_controller",
    });
    expect(rejected.success).toBe(true);

    const mismatch = parseGameEvent({
      type: "PROTOCOL_MISMATCH",
      expectedProtocolVersion: PROTOCOL_VERSION,
      actualProtocolVersion: 99,
      expectedGameDataVersion: GAME_DATA_VERSION,
      actualGameDataVersion: "1.0.0",
    });
    expect(mismatch.success).toBe(true);
  });

  it("rejects invalid events", () => {
    expect(parseGameEvent({ type: "COMMAND_REJECTED" }).success).toBe(false);
  });

  it("accepts a minimal game state view DTO", () => {
    const result = parseGameStateView({
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      roomId: "room-1",
      tick: 12,
      phase: "RUNNING",
      localPlayerId: 0,
      players: [{ playerId: 0, connected: true }],
      entities: [
        {
          entityId: 1,
          kind: "unit",
          x: 1,
          y: 2,
          ownerPlayerId: 0,
          controllerPlayerId: 0,
          objectiveType: null,
          objectiveState: null,
        },
        {
          entityId: 2,
          kind: "objective",
          x: 0,
          y: 0,
          ownerPlayerId: null,
          controllerPlayerId: null,
          objectiveType: "SACRED_SITE",
          objectiveState: "ACTIVE",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an objective view that omits type and state", () => {
    expect(
      parseGameStateView({
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        roomId: "room-1",
        tick: 0,
        phase: "RUNNING",
        localPlayerId: 0,
        players: [],
        entities: [
          {
            entityId: 2,
            kind: "objective",
            x: 0,
            y: 0,
            ownerPlayerId: null,
            controllerPlayerId: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a state view that carries a reconnection token", () => {
    expect(
      parseGameStateView({
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        roomId: "room-1",
        tick: 0,
        phase: "LOBBY",
        localPlayerId: 0,
        players: [],
        entities: [],
        reconnectionToken: "room-1:secret",
      }).success,
    ).toBe(false);
  });

  it("rejects state views missing localPlayerId", () => {
    expect(
      parseGameStateView({
        protocolVersion: PROTOCOL_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        roomId: "room-1",
        tick: 0,
        phase: "LOBBY",
        players: [],
        entities: [],
      }).success,
    ).toBe(false);
  });
});

describe("GameTransport contract", () => {
  it("describes connect/resume/session/subscriptions/disconnect without Colyseus types", () => {
    const connectOptions: ConnectOptions = {
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      createRoom: true,
    };

    const listeners: { state?: unknown; event?: unknown } = {};

    const transport: GameTransport = {
      async connect(options) {
        expect(options).toEqual(connectOptions);
      },
      async resumePreviousSession() {
        return { status: "absent" };
      },
      sendCommand(command) {
        expect(command.type).toBe("MOVE");
      },
      subscribeState(listener) {
        listeners.state = listener;
        return () => {
          listeners.state = undefined;
        };
      },
      subscribeEvent(listener) {
        listeners.event = listener;
        return () => {
          listeners.event = undefined;
        };
      },
      subscribeConnection() {
        return () => {
          /* no-op */
        };
      },
      startMatch() {
        /* session control, not a GameCommand */
      },
      connectedRoomId: null,
      hasResumeToken() {
        return false;
      },
      readRoundTripMs() {
        return null;
      },
      async disconnect() {
        /* no-op */
      },
    };

    void transport;
    expect(typeof transport.connect).toBe("function");
    expect(typeof transport.resumePreviousSession).toBe("function");
    expect(typeof transport.sendCommand).toBe("function");
    expect(typeof transport.subscribeState).toBe("function");
    expect(typeof transport.subscribeEvent).toBe("function");
    expect(typeof transport.subscribeConnection).toBe("function");
    expect(typeof transport.startMatch).toBe("function");
    expect(transport.connectedRoomId).toBeNull();
    expect(transport.hasResumeToken()).toBe(false);
    expect(transport.readRoundTripMs()).toBeNull();
    expect(typeof transport.disconnect).toBe("function");
  });
});
