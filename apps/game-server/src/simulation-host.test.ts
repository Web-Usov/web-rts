import { describe, expect, it } from "vitest";
import { parseGameCommand, type MoveCommand } from "@web-rts/protocol";
import { SimulationHost } from "./simulation-host.js";

const move: MoveCommand = {
  type: "MOVE",
  commandId: "cmd-host-1",
  clientSequence: 1,
  entityIds: [1],
  target: { x: 1, y: 2 },
};

describe("SimulationHost", () => {
  it("creates a world with configured seed and stores mapId", () => {
    const host = new SimulationHost({ seed: 42, mapId: "map-alpha" });
    expect(host.seed).toBe(42);
    expect(host.mapId).toBe("map-alpha");
    expect(host.world.config.seed).toBe(42);
    expect(host.tick).toBe(0);
  });

  it("enqueues mapped commands from session context without transport fields", () => {
    const host = new SimulationHost({ seed: 1, mapId: "foundation" });
    const parsed = parseGameCommand(move);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    const mapped = host.enqueueFromSession(parsed.data, {
      playerId: 2,
      sessionId: "session-2",
    });

    expect(mapped).not.toHaveProperty("clientSequence");
    expect(mapped).not.toHaveProperty("playerId");
    expect(host.pendingCommandCount()).toBe(1);

    host.step();
    expect(host.pendingCommandCount()).toBe(0);
    expect(host.tick).toBe(1);
  });
});
