import { describe, expect, it } from "vitest";
import { GAME_DATA_VERSION, PROTOCOL_VERSION } from "@web-rts/protocol";
import { parseRoomJoinOptions } from "./join-options.js";
import { PlayerSlotRegistry } from "./player-slots.js";
import { DEFAULT_RECONNECT_GRACE_SECONDS, MAX_PLAYERS } from "./constants.js";

describe("parseRoomJoinOptions", () => {
  it("accepts compatible versions and defaults seed/mapId", () => {
    const result = parseRoomJoinOptions({
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seed).toBe(0);
      expect(result.data.mapId).toBe("foundation");
    }
  });

  it("rejects protocol version mismatch", () => {
    const result = parseRoomJoinOptions({
      protocolVersion: PROTOCOL_VERSION + 10,
      gameDataVersion: GAME_DATA_VERSION,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("protocol_mismatch");
      expect(result.compatibility?.protocolMatch).toBe(false);
    }
  });
});

describe("reconnect grace", () => {
  it("keeps the production reservation at 30 seconds", () => {
    expect(DEFAULT_RECONNECT_GRACE_SECONDS).toBe(30);
  });

  it("drops a client grace override from join options", () => {
    const result = parseRoomJoinOptions({
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      reconnectGraceSeconds: 999_999,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("reconnectGraceSeconds");
    }
  });
});

describe("PlayerSlotRegistry", () => {
  it("allocates unique playerIds and marks disconnect without removing the slot", () => {
    const slots = new PlayerSlotRegistry();
    const a = slots.allocate("s1");
    const b = slots.allocate("s2");
    expect(a?.playerId).toBe(0);
    expect(b?.playerId).toBe(1);
    slots.markDisconnected("s1");
    expect(slots.getBySessionId("s1")?.connected).toBe(false);
    expect(slots.size).toBe(2);
    slots.markConnected("s1");
    expect(slots.getBySessionId("s1")?.connected).toBe(true);
    expect(slots.getBySessionId("s1")?.playerId).toBe(0);
    expect(slots.size).toBe(2);
  });

  it("release frees capacity so a new session can allocate after leave", () => {
    const slots = new PlayerSlotRegistry();
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      expect(slots.allocate(`s${i}`)).toBeDefined();
    }
    expect(slots.allocate("overflow")).toBeUndefined();

    expect(slots.release("s0")?.playerId).toBe(0);
    expect(slots.getBySessionId("s0")).toBeUndefined();
    expect(slots.size).toBe(MAX_PLAYERS - 1);

    const replacement = slots.allocate("s-new");
    expect(replacement).toBeDefined();
    expect(slots.size).toBe(MAX_PLAYERS);
  });

  it("refuses allocation beyond max players", () => {
    const slots = new PlayerSlotRegistry();
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      expect(slots.allocate(`s${i}`)).toBeDefined();
    }
    expect(slots.allocate("overflow")).toBeUndefined();
  });
});
