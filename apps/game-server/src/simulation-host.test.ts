import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP_HALF_EXTENT } from "@web-rts/game-data";
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

  it("bootstraps one primitive unit per player and enqueues bound MOVE", () => {
    const host = new SimulationHost({ seed: 1, mapId: "foundation" });
    host.bootstrapMatch([0, 1]);

    const unit0 = host.primitiveUnits.getEntityId(0);
    const unit1 = host.primitiveUnits.getEntityId(1);
    expect(unit0).toBeDefined();
    expect(unit1).toBeDefined();
    expect(unit0).not.toBe(unit1);
    expect(host.world.entityIds()).toHaveLength(2);

    const parsed = parseGameCommand({
      ...move,
      entityIds: [unit0!],
      target: { x: 2, y: 3 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    const result = host.enqueueFromSession(parsed.data, {
      playerId: 0,
      sessionId: "session-0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command).not.toHaveProperty("clientSequence");
      expect(result.command).not.toHaveProperty("playerId");
    }
    expect(host.pendingCommandCount()).toBe(1);

    host.step();
    expect(host.pendingCommandCount()).toBe(0);
    expect(host.tick).toBe(1);
  });

  it("assigns distinct spawns when player ids are not 0..3", () => {
    const host = new SimulationHost({ seed: 1, mapId: "foundation" });
    host.bootstrapMatch([0, 2, 3, 4]);

    const points = [0, 2, 3, 4].map((playerId) => {
      const entityId = host.primitiveUnits.getEntityId(playerId);
      expect(entityId).toBeDefined();
      return host.world.positions.get(entityId!);
    });
    const keys = new Set(points.map((point) => `${point?.x},${point?.y}`));
    expect(keys.size).toBe(4);
  });

  it("rejects MOVE for a foreign primitive unit without enqueueing", () => {
    const host = new SimulationHost({ seed: 1, mapId: "foundation" });
    host.bootstrapMatch([0, 1]);
    const foreign = host.primitiveUnits.getEntityId(1)!;

    const result = host.enqueueFromSession(
      { ...move, entityIds: [foreign], commandId: "steal" },
      { playerId: 0, sessionId: "session-0" },
    );
    expect(result).toEqual({ ok: false, reason: "not_your_unit" });
    expect(host.pendingCommandCount()).toBe(0);
  });

  it("rejects out-of-bounds MOVE without enqueueing", () => {
    const host = new SimulationHost({ seed: 1, mapId: "foundation" });
    host.bootstrapMatch([0]);
    const unit = host.primitiveUnits.getEntityId(0)!;

    const result = host.enqueueFromSession(
      {
        ...move,
        entityIds: [unit],
        target: { x: FOUNDATION_MAP_HALF_EXTENT + 1, y: 0 },
        commandId: "oob",
      },
      { playerId: 0, sessionId: "session-0" },
    );
    expect(result).toEqual({ ok: false, reason: "out_of_bounds" });
    expect(host.pendingCommandCount()).toBe(0);
  });
});
