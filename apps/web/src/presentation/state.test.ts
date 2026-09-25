import { describe, expect, it } from "vitest";
import { developerPresentationFixture } from "./fixture.js";
import { PresentationState } from "./state.js";
import type { PresentationSyncData } from "./types.js";

describe("presentation state", () => {
  it("creates and updates entities from sync data", () => {
    const state = new PresentationState();
    const created = state.apply(developerPresentationFixture);

    expect(created.upserted.map((entity) => entity.id)).toEqual([1, 2, 3]);
    expect(state.getHudView()).toEqual({
      entityCount: 3,
      objectiveCount: 1,
      selectedIds: [],
      hasDestination: false,
    });

    const moved: PresentationSyncData = {
      ...developerPresentationFixture,
      entities: developerPresentationFixture.entities.map((entity) =>
        entity.id === 1 ? { ...entity, position: { x: 1, y: 0.6, z: 2 } } : entity,
      ),
      selectedIds: [1],
      destination: { x: 4, z: -2 },
    };

    const updated = state.apply(moved);
    expect(updated.upserted).toEqual([moved.entities[0]]);
    expect(updated.removedIds).toEqual([]);
    expect(state.getEntity(1)?.position).toEqual({ x: 1, y: 0.6, z: 2 });
    expect(state.getHudView()).toEqual({
      entityCount: 3,
      objectiveCount: 1,
      selectedIds: [1],
      hasDestination: true,
    });
  });

  it("removes entities missing from the next sync and drops stale selection", () => {
    const state = new PresentationState();
    state.apply(developerPresentationFixture);
    state.select(2);

    const diff = state.apply({
      entities: developerPresentationFixture.entities.filter((entity) => entity.id !== 2),
      selectedIds: [2],
      destination: null,
    });

    expect(diff.removedIds).toEqual([2]);
    expect(state.getEntity(2)).toBeUndefined();
    expect(state.getSelectedIds()).toEqual([]);
  });

  it("keeps transforms out of the HUD view", () => {
    const state = new PresentationState();
    state.apply(developerPresentationFixture);
    state.select(3);
    state.setDestination({ x: 0, z: 0 });

    expect(Object.keys(state.getHudView()).sort()).toEqual([
      "entityCount",
      "hasDestination",
      "objectiveCount",
      "selectedIds",
    ]);
  });
});
