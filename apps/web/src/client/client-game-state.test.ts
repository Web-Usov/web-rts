import { describe, expect, it } from "vitest";
import { GAME_DATA_VERSION, PROTOCOL_VERSION, type GameStateView } from "@web-rts/protocol";
import { ClientGameState } from "./client-game-state.js";
import { PresentationState } from "../presentation/state.js";

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
        kind: "UNIT",
        definitionId: "foundation_unit",
        x: 0,
        y: 0,
        ownerPlayerId: 0,
        controllerPlayerId: 0,
        objectiveType: null,
        objectiveState: null,
      },
      {
        entityId: 11,
        kind: "UNIT",
        definitionId: "foundation_unit",
        x: 5,
        y: 5,
        ownerPlayerId: 1,
        controllerPlayerId: 1,
        objectiveType: null,
        objectiveState: null,
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
            kind: "UNIT",
            definitionId: "foundation_unit",
            x: 10,
            y: 0,
            ownerPlayerId: 0,
            controllerPlayerId: 0,
            objectiveType: null,
            objectiveState: null,
          },
          {
            entityId: 11,
            kind: "UNIT",
            definitionId: "foundation_unit",
            x: 5,
            y: 5,
            ownerPlayerId: 1,
            controllerPlayerId: 1,
            objectiveType: null,
            objectiveState: null,
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
            kind: "UNIT",
            definitionId: "foundation_unit",
            x: 20,
            y: 0,
            ownerPlayerId: 0,
            controllerPlayerId: 0,
            objectiveType: null,
            objectiveState: null,
          },
          {
            entityId: 11,
            kind: "UNIT",
            definitionId: "foundation_unit",
            x: 5,
            y: 5,
            ownerPlayerId: 1,
            controllerPlayerId: 1,
            objectiveType: null,
            objectiveState: null,
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

  it("treats selection as local UX gated by replicated controller", () => {
    const state = new ClientGameState();
    state.applyAuthoritativeState(
      view({
        entities: [
          ...view().entities,
          {
            entityId: 12,
            kind: "OBJECTIVE",
            definitionId: "sacred_site",
            x: 0,
            y: 0,
            ownerPlayerId: null,
            controllerPlayerId: null,
            objectiveType: "PROTECT",
            objectiveState: "ACTIVE",
          },
        ],
      }),
      0,
    );
    expect(state.canLocalPlayerControl(10)).toBe(true);
    expect(state.canLocalPlayerControl(11)).toBe(false);
    expect(state.canLocalPlayerControl(12)).toBe(false);
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

  it("reset clears the presented match so the next room does not interpolate the old one", () => {
    const state = new ClientGameState();
    const presentation = new PresentationState();
    state.subscribeState((poses) => {
      const marker = state.getDestinationMarker();
      presentation.apply({
        entities: poses.map((pose) => ({
          id: pose.entityId,
          kind: pose.kind,
          position: { x: pose.x, y: 0, z: pose.y },
          colorSlot: 0,
        })),
        selectedIds: [...state.getSelectedIds()],
        destination: marker ? { x: marker.x, z: marker.y } : null,
      });
    });

    state.applyAuthoritativeState(view({ tick: 1 }), 0);
    state.applyAuthoritativeState(
      view({
        tick: 2,
        entities: view().entities.map((entity) =>
          entity.entityId === 10 ? { ...entity, x: 100 } : entity,
        ),
      }),
      100,
    );
    state.select(10);
    state.setDestinationMarker({ x: 3, y: 4 });
    expect(presentation.getEntities().length).toBeGreaterThan(0);
    expect(presentation.getHudView().hasDestination).toBe(true);

    state.reset();

    expect(state.getView()).toBeNull();
    expect(state.sample(10_000)).toEqual([]);
    expect(state.getSelectedIds()).toEqual([]);
    expect(state.getDestinationMarker()).toBeNull();
    expect(state.getConnectedPlayerCount()).toBe(0);
    expect(state.getLocalUnitEntityId()).toBeNull();
    expect(presentation.getEntities()).toEqual([]);
    expect(presentation.getSelectedIds()).toEqual([]);
    expect(presentation.getDestination()).toBeNull();
    expect(presentation.getHudView()).toEqual({
      entityCount: 0,
      objectiveCount: 0,
      selectedIds: [],
      hasDestination: false,
    });

    state.applyAuthoritativeState(
      view({
        roomId: "next-room",
        tick: 0,
        entities: view().entities.map((entity) =>
          entity.entityId === 10 ? { ...entity, x: 1 } : entity,
        ),
      }),
      5_000,
    );
    expect(state.sample(5_000).find((pose) => pose.entityId === 10)?.x).toBe(1);
    expect(state.getView()?.roomId).toBe("next-room");
  });
});
