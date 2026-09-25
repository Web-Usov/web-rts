import { describe, expect, it } from "vitest";
import { createWorld } from "@web-rts/simulation";
import { PROTOCOL_VERSION, GAME_DATA_VERSION } from "@web-rts/protocol";
import { projectWorldToGameStateView } from "./replication-adapter.js";
import { PrimitiveUnitRegistry } from "./primitive-units.js";

describe("ReplicationAdapter", () => {
  it("projects World positions into GameStateView without leaking World", () => {
    const world = createWorld({ seed: 9 });
    const registry = new PrimitiveUnitRegistry();
    registry.spawnForPlayers(world, [0, 1]);

    const view = projectWorldToGameStateView({
      world,
      roomId: "room-abc",
      phase: "RUNNING",
      localPlayerId: 1,
      players: [
        { playerId: 0, connected: true },
        { playerId: 1, connected: true },
      ],
      bindings: registry.snapshot(),
    });

    expect(view.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(view.gameDataVersion).toBe(GAME_DATA_VERSION);
    expect(view.roomId).toBe("room-abc");
    expect(view.localPlayerId).toBe(1);
    expect(view.tick).toBe(0);
    expect(view.entities).toHaveLength(2);
    expect(view).not.toHaveProperty("world");
    expect(view).not.toHaveProperty("positions");
    expect(view).not.toHaveProperty("movements");
    expect(Object.keys(view).sort()).toEqual([
      "entities",
      "gameDataVersion",
      "localPlayerId",
      "phase",
      "players",
      "protocolVersion",
      "roomId",
      "tick",
    ]);

    const unit0 = registry.getEntityId(0)!;
    const projected = view.entities.find((e) => e.entityId === unit0);
    expect(projected).toMatchObject({
      kind: "unit",
      ownerPlayerId: 0,
      controllerPlayerId: 0,
    });
    expect(typeof projected?.x).toBe("number");
    expect(typeof projected?.y).toBe("number");
  });

  it("projects empty entities in lobby when world is null", () => {
    const view = projectWorldToGameStateView({
      world: null,
      roomId: "lobby",
      phase: "LOBBY",
      localPlayerId: 0,
      players: [{ playerId: 0, connected: true }],
      bindings: new Map(),
    });
    expect(view.entities).toEqual([]);
    expect(view.phase).toBe("LOBBY");
    expect(view.tick).toBe(0);
  });

  it("keeps per-recipient localPlayerId different while sharing entity set", () => {
    const world = createWorld({ seed: 1 });
    const registry = new PrimitiveUnitRegistry();
    registry.spawnForPlayers(world, [0, 1]);
    const players = [
      { playerId: 0, connected: true },
      { playerId: 1, connected: true },
    ];

    const forA = projectWorldToGameStateView({
      world,
      roomId: "r",
      phase: "RUNNING",
      localPlayerId: 0,
      players,
      bindings: registry.snapshot(),
    });
    const forB = projectWorldToGameStateView({
      world,
      roomId: "r",
      phase: "RUNNING",
      localPlayerId: 1,
      players,
      bindings: registry.snapshot(),
    });

    expect(forA.localPlayerId).toBe(0);
    expect(forB.localPlayerId).toBe(1);
    expect(forA.entities.map((e) => e.entityId).sort()).toEqual(
      forB.entities.map((e) => e.entityId).sort(),
    );
  });
});

describe("PrimitiveUnitRegistry", () => {
  it("binds player slots to entities and blocks foreign control", () => {
    const world = createWorld({ seed: 2 });
    const registry = new PrimitiveUnitRegistry();
    registry.spawnForPlayers(world, [0, 1]);

    const a = registry.getEntityId(0)!;
    const b = registry.getEntityId(1)!;
    expect(registry.canControlEntities(0, [a])).toBe(true);
    expect(registry.canControlEntities(0, [b])).toBe(false);
    expect(registry.canControlEntities(0, [a, b])).toBe(false);
    expect(registry.canControlEntities(0, [])).toBe(false);
    expect(registry.getPlayerId(a)).toBe(0);
  });
});
