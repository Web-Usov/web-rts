import { describe, expect, it } from "vitest";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  gameEventSchema,
  gameStateViewSchema,
  type GameCommand,
} from "@web-rts/protocol";
import { createMatchRuntime, type MatchSnapshot } from "@web-rts/simulation";
import { projectGameStateView, toGameEvent, toSimulationCommand } from "./index.js";

const move: GameCommand = {
  type: "MOVE",
  commandId: "cmd-1",
  clientSequence: 7,
  entityIds: [1, 2],
  target: { x: 3, y: 4 },
};

const session = {
  roomId: "room-abc",
  phase: "RUNNING",
  players: [
    { playerId: 0, connected: true },
    { playerId: 1, connected: false },
  ],
} as const;

function runningSnapshot(): MatchSnapshot {
  return createMatchRuntime({
    seed: 9,
    mapId: "foundation",
    participants: [{ playerId: 0 }, { playerId: 1 }],
  }).readSnapshot();
}

describe("toSimulationCommand", () => {
  it("maps MOVE without clientSequence or identity", () => {
    const mapped = toSimulationCommand(move);
    expect(mapped).toEqual({
      type: "MOVE",
      commandId: "cmd-1",
      entityIds: [1, 2],
      target: { x: 3, y: 4 },
    });
    expect(mapped).not.toHaveProperty("clientSequence");
    expect(mapped).not.toHaveProperty("playerId");
    expect(mapped).not.toHaveProperty("sessionId");
  });

  it("copies arrays so protocol DTO mutations do not alias the command", () => {
    const command: GameCommand = { ...move, entityIds: [10] };
    const mapped = toSimulationCommand(command);
    command.entityIds.push(99);
    command.target.x = 100;
    expect(mapped.entityIds).toEqual([10]);
    expect(mapped.target).toEqual({ x: 3, y: 4 });
  });
});

describe("projectGameStateView", () => {
  it("projects a runtime snapshot into a schema-valid GameStateView", () => {
    const snapshot = runningSnapshot();
    const view = projectGameStateView(snapshot, { localPlayerId: 1 }, session);

    expect(gameStateViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      gameDataVersion: GAME_DATA_VERSION,
      roomId: "room-abc",
      tick: 0,
      phase: "RUNNING",
      localPlayerId: 1,
      players: session.players,
    });
    expect(view.entities).toEqual(snapshot.entities);
    expect(view.entities.find((entity) => entity.kind === "OBJECTIVE")).toMatchObject({
      x: 0,
      y: 0,
      ownerPlayerId: null,
      controllerPlayerId: null,
      objectiveType: "PROTECT",
      objectiveState: "ACTIVE",
    });
  });

  it("passes every broad kind and definitionId through without inferring kind", () => {
    const base = runningSnapshot();
    const snapshot: MatchSnapshot = {
      ...base,
      entities: (["UNIT", "BUILDING", "RESOURCE", "OBJECTIVE"] as const).map((kind, index) => ({
        entityId: index + 1,
        kind,
        definitionId: `def_${kind.toLowerCase()}`,
        x: index,
        y: 0,
        ownerPlayerId: null,
        controllerPlayerId: null,
        objectiveType: kind === "BUILDING" ? "PROTECT" : null,
        objectiveState: kind === "BUILDING" ? "ACTIVE" : null,
      })),
    };
    const view = projectGameStateView(snapshot, { localPlayerId: 0 }, session);

    expect(gameStateViewSchema.safeParse(view).success).toBe(true);
    expect(
      view.entities.map(({ kind, definitionId, objectiveType }) => [
        kind,
        definitionId,
        objectiveType,
      ]),
    ).toEqual([
      ["UNIT", "def_unit", null],
      ["BUILDING", "def_building", "PROTECT"],
      ["RESOURCE", "def_resource", null],
      ["OBJECTIVE", "def_objective", null],
    ]);
  });

  it("shares entities between recipients and changes only localPlayerId", () => {
    const snapshot = runningSnapshot();
    const forA = projectGameStateView(snapshot, { localPlayerId: 0 }, session);
    const forB = projectGameStateView(snapshot, { localPlayerId: 1 }, session);
    expect(forA.entities).toEqual(forB.entities);
    expect({ ...forA, localPlayerId: 1 }).toEqual(forB);
  });

  it("projects lobby state without a snapshot", () => {
    const view = projectGameStateView(
      null,
      { localPlayerId: 0 },
      { roomId: "lobby", phase: "LOBBY", players: [{ playerId: 0, connected: true }] },
    );
    expect(view.entities).toEqual([]);
    expect(view.tick).toBe(0);
    expect(view.phase).toBe("LOBBY");
  });

  it("does not leak snapshot status or session objects", () => {
    const view = projectGameStateView(runningSnapshot(), { localPlayerId: 0 }, session);
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
    expect(view.players).not.toBe(session.players);
  });
});

describe("toGameEvent", () => {
  it("maps a runtime rejection to the wire COMMAND_REJECTED event", () => {
    const event = toGameEvent({
      type: "COMMAND_REJECTED",
      recipientPlayerId: 3,
      commandId: "m-1",
      reason: "not_your_unit",
      tick: 12,
    });
    expect(event).toEqual({ type: "COMMAND_REJECTED", commandId: "m-1", reason: "not_your_unit" });
    expect(gameEventSchema.safeParse(event).success).toBe(true);
  });
});
