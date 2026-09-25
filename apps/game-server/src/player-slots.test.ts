import { describe, expect, it } from "vitest";
import { GAME_DATA_VERSION, PROTOCOL_VERSION } from "@web-rts/protocol";
import { parseRoomJoinOptions } from "./join-options.js";
import { PlayerSlotRegistry } from "./player-slots.js";
import { MAX_PLAYERS } from "./constants.js";

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
  });

  it("refuses allocation beyond max players", () => {
    const slots = new PlayerSlotRegistry();
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      expect(slots.allocate(`s${i}`)).toBeDefined();
    }
    expect(slots.allocate("overflow")).toBeUndefined();
  });
});
