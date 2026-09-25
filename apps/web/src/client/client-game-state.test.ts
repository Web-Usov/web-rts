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

    // Delay is one tick: playback time 50 is render time 150.
    const atArrival = state.sample(100);
    expect(atArrival.find((pose) => pose.entityId === 10)?.x).toBe(0);
    const mid = state.sample(150);
    const unit = mid.find((pose) => pose.entityId === 10);
    expect(unit?.x).toBe(5);
    expect(state.sample(200).find((pose) => pose.entityId === 10)?.x).toBe(10);

    state.applyAuthoritativeState(
      view({
        tick: 3,
        entities: [
          {
            entityId: 10,
            kind: "unit",
            x: 20,
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
      200,
    );

    expect(state.sample(200).find((pose) => pose.entityId === 10)?.x).toBe(10);
    expect(state.sample(250).find((pose) => pose.entityId === 10)?.x).toBe(15);
    expect(state.sample(300).find((pose) => pose.entityId === 10)?.x).toBe(20);
  });

  it("does not treat the bound unit as selected when nothing is selected", () => {
    const state = new ClientGameState();
    state.applyAuthoritativeState(view(), 0);
    expect(state.getLocalUnitEntityId()).toBe(10);
    expect(state.getCommandEntityId()).toBeNull();
    state.select(10);
    expect(state.getCommandEntityId()).toBe(10);
    state.select(null);
    expect(state.getCommandEntityId()).toBeNull();
  });

  it("reports the connected player count from the authoritative view", () => {
    const state = new ClientGameState();
    expect(state.getConnectedPlayerCount()).toBe(0);
    state.applyAuthoritativeState(
      view({
        players: [
          { playerId: 0, connected: true },
          { playerId: 1, connected: false },
        ],
      }),
      0,
    );
    expect(state.getConnectedPlayerCount()).toBe(1);
    state.applyAuthoritativeState(view(), 100);
    expect(state.getConnectedPlayerCount()).toBe(2);
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
