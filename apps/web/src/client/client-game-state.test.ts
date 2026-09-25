import { describe, expect, it } from "vitest";
import { GAME_DATA_VERSION, PROTOCOL_VERSION, type GameStateView } from "@web-rts/protocol";
import { ClientGameState } from "./client-game-state.js";

function view(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    protocolVersion: PROTOCOL_VERSION,
    gameDataVersion: GAME_DATA_VERSION,
    roomId: "r1",
    tick: 0,
    phase: "RUNNING",
    localPlayerId: 0,
    players: [
      { playerId: 0, connected: true },
      { playerId: 1, connected: true },
    ],
    entities: [
      {
        entityId: 10,
        kind: "unit",
        x: 0,
        y: 0,
        ownerPlayerId: 0,
        controllerPlayerId: 0,
      },
      {
        entityId: 11,
        kind: "unit",
        x: 5,
        y: 5,
        ownerPlayerId: 1,
        controllerPlayerId: 1,
      },
    ],
    ...overrides,
  };
}

describe("ClientGameState", () => {
  it("maps localPlayerId to the bound primitive unit without array-order guessing", () => {
    const state = new ClientGameState();
    state.applyAuthoritativeState(view({ localPlayerId: 1 }), 0);
    expect(state.getLocalPlayerId()).toBe(1);
    expect(state.getLocalUnitEntityId()).toBe(11);
  });

  it("interpolates between snapshots using explicit render time", () => {
    const state = new ClientGameState();
    state.applyAuthoritativeState(view({ tick: 1 }), 0);
    state.applyAuthoritativeState(
      view({
        tick: 2,
        entities: [
          {
            entityId: 10,
            kind: "unit",
            x: 10,
            y: 0,
            ownerPlayerId: 0,
            controllerPlayerId: 0,
          },
          {
            entityId: 11,
            kind: "unit",
            x: 5,
            y: 5,
            ownerPlayerId: 1,
            controllerPlayerId: 1,
          },
        ],
      }),
      100,
    );

    const mid = state.sample(50);
    const unit = mid.find((pose) => pose.entityId === 10);
    expect(unit?.x).toBe(5);
  });

  it("destination marker does not alter authoritative entity poses", () => {
    const state = new ClientGameState();
    state.applyAuthoritativeState(view(), 0);
    const before = state.sample(0).map((pose) => ({ ...pose }));
    state.setDestinationMarker({ x: 99, y: 99 });
    expect(state.getDestinationMarker()).toEqual({ x: 99, y: 99 });
    expect(state.sample(0)).toEqual(before);
    expect(state.getView()?.entities.find((e) => e.entityId === 10)?.x).toBe(0);
  });
});
