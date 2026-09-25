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

    const objectiveId = world.createEntity();
    world.positions.set(objectiveId, { x: 0, y: 0 });
    world.objectives.set(objectiveId, { type: "SACRED_SITE", state: "ACTIVE" });

    const view = projectWorldToGameStateView({
      world,
      roomId: "room-abc",
      phase: "RUNNING",
      localPlayerId: 1,
      players: [
        { playerId: 0, connected: true },
        { playerId: 1, connected: true },
      ],
    });

    expect(view.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(view.gameDataVersion).toBe(GAME_DATA_VERSION);
    expect(view.roomId).toBe("room-abc");
    expect(view.localPlayerId).toBe(1);
    expect(view.tick).toBe(0);
    expect(view.entities).toHaveLength(3);
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
      objectiveType: null,
      objectiveState: null,
    });
    expect(world.owners.get(unit0)?.ownerPlayerId).toBe(0);
    expect(typeof projected?.x).toBe("number");
    expect(typeof projected?.y).toBe("number");

    const objective = view.entities.find((entity) => entity.entityId === objectiveId);
    expect(objective).toMatchObject({
      kind: "objective",
      x: 0,
      y: 0,
      ownerPlayerId: null,
      controllerPlayerId: null,
      objectiveType: "SACRED_SITE",
      objectiveState: "ACTIVE",
    });
  });

  it("reads owner and controller from World components, not from the unit index", () => {
    const world = createWorld({ seed: 4 });
    const registry = new PrimitiveUnitRegistry();
    registry.spawnForPlayers(world, [0]);
    const unitId = registry.getEntityId(0)!;
    world.controllers.set(unitId, { controllerPlayerId: 1 });

    const view = projectWorldToGameStateView({
      world,
      roomId: "r",
      phase: "RUNNING",
      localPlayerId: 0,
      players: [
        { playerId: 0, connected: true },
        { playerId: 1, connected: true },
      ],
    });

    expect(view.entities.find((entity) => entity.entityId === unitId)).toMatchObject({
      ownerPlayerId: 0,
      controllerPlayerId: 1,
    });
  });

  it("projects empty entities in lobby when world is null", () => {
    const view = projectWorldToGameStateView({
      world: null,
      roomId: "lobby",
      phase: "LOBBY",
      localPlayerId: 0,
      players: [{ playerId: 0, connected: true }],
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
    });
    const forB = projectWorldToGameStateView({
      world,
      roomId: "r",
      phase: "RUNNING",
      localPlayerId: 1,
      players,
    });

    expect(forA.localPlayerId).toBe(0);
    expect(forB.localPlayerId).toBe(1);
    expect(forA.entities.map((e) => e.entityId).sort()).toEqual(
      forB.entities.map((e) => e.entityId).sort(),
    );
  });
});

describe("PrimitiveUnitRegistry", () => {
  it("indexes player slots and writes Owner plus Controller on the world", () => {
    const world = createWorld({ seed: 2 });
    const registry = new PrimitiveUnitRegistry();
    registry.spawnForPlayers(world, [0, 1]);

    const a = registry.getEntityId(0)!;
    const b = registry.getEntityId(1)!;
    expect(a).not.toBe(b);
    expect(world.owners.get(a)).toEqual({ ownerPlayerId: 0 });
    expect(world.controllers.get(a)).toEqual({ controllerPlayerId: 0 });
    expect(world.owners.get(b)).toEqual({ ownerPlayerId: 1 });
    expect(world.controllers.get(b)).toEqual({ controllerPlayerId: 1 });
  });
});
