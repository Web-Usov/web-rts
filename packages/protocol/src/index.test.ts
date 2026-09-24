import { describe, expect, it } from "vitest";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  parseGameCommand,
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
    expect(PROTOCOL_VERSION).toBe(1);
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
      players: [{ playerId: 0, connected: true }],
      entities: [
        {
          entityId: 1,
          kind: "unit",
          x: 1,
          y: 2,
          ownerPlayerId: 0,
          controllerPlayerId: 0,
        },
        {
          entityId: 2,
          kind: "objective",
          x: 0,
          y: 0,
          ownerPlayerId: null,
          controllerPlayerId: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid state views", () => {
    expect(parseGameStateView({ phase: "RUNNING" }).success).toBe(false);
  });
});

describe("GameTransport contract", () => {
  it("describes connect/sendCommand/subscriptions/disconnect without Colyseus types", () => {
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
      async disconnect() {
        /* no-op */
      },
    };

    void transport;
    expect(typeof transport.connect).toBe("function");
    expect(typeof transport.sendCommand).toBe("function");
    expect(typeof transport.subscribeState).toBe("function");
    expect(typeof transport.subscribeEvent).toBe("function");
    expect(typeof transport.disconnect).toBe("function");
  });
});
