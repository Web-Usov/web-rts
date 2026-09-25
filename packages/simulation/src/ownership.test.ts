import { describe, expect, it } from "vitest";
import { canIssueMove, createWorld } from "./index.js";

describe("owner and controller", () => {
  it("stores Owner and Controller independently", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.owners.set(entityId, { ownerPlayerId: 0 });
    world.controllers.set(entityId, { controllerPlayerId: 1 });

    expect(world.owners.get(entityId)).toEqual({ ownerPlayerId: 0 });
    expect(world.controllers.get(entityId)).toEqual({ controllerPlayerId: 1 });
  });

  it("allows MOVE only for the current controller", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.positions.set(entityId, { x: 0, y: 0 });
    world.owners.set(entityId, { ownerPlayerId: 0 });
    world.controllers.set(entityId, { controllerPlayerId: 0 });

    expect(canIssueMove(world, 0, [entityId])).toBe(true);
    expect(canIssueMove(world, 1, [entityId])).toBe(false);
  });

  it("changes MOVE permission when controller changes and keeps the owner", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.positions.set(entityId, { x: 0, y: 0 });
    world.owners.set(entityId, { ownerPlayerId: 0 });
    world.controllers.set(entityId, { controllerPlayerId: 0 });

    world.controllers.set(entityId, { controllerPlayerId: 1 });

    expect(world.owners.get(entityId)?.ownerPlayerId).toBe(0);
    expect(canIssueMove(world, 0, [entityId])).toBe(false);
    expect(canIssueMove(world, 1, [entityId])).toBe(true);
  });

  it("rejects MOVE for an entity without a Controller", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.positions.set(entityId, { x: 0, y: 0 });
    world.owners.set(entityId, { ownerPlayerId: 0 });

    expect(world.controllers.has(entityId)).toBe(false);
    expect(canIssueMove(world, 0, [entityId])).toBe(false);
  });

  it("rejects MOVE for an objective that has no Controller", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.positions.set(entityId, { x: 0, y: 0 });
    world.objectives.set(entityId, { type: "SACRED_SITE", state: "ACTIVE" });

    expect(canIssueMove(world, 0, [entityId])).toBe(false);
    expect(canIssueMove(world, 1, [entityId])).toBe(false);
  });

  it("drops owner, controller, and objective when the entity is destroyed", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.owners.set(entityId, { ownerPlayerId: 0 });
    world.controllers.set(entityId, { controllerPlayerId: 0 });
    world.objectives.set(entityId, { type: "SACRED_SITE", state: "ACTIVE" });

    world.destroyEntity(entityId);

    expect(world.owners.has(entityId)).toBe(false);
    expect(world.controllers.has(entityId)).toBe(false);
    expect(world.objectives.has(entityId)).toBe(false);
  });
});
