import { describe, expect, it } from "vitest";
import { FOUNDATION_MAP } from "@web-rts/game-data";
import type { QueuedCommand } from "./commands.js";
import { createWorld, type World } from "./world.js";

function controlledUnit(world: World, playerId: number): number {
  const entityId = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
  world.positions.set(entityId, { x: 0, y: 0 });
  world.owners.set(entityId, { ownerPlayerId: playerId });
  world.controllers.set(entityId, { controllerPlayerId: playerId });
  return entityId;
}

function move(
  playerId: number,
  commandId: string,
  entityIds: number[],
  target = { x: 1, y: 0 },
): QueuedCommand {
  return { actor: { playerId }, command: { type: "MOVE", commandId, entityIds, target } };
}

function rejections(world: World): Array<{ commandId: string; playerId: number; reason: string }> {
  return world
    .drainEvents()
    .flatMap((event) =>
      event.type === "COMMAND_REJECTED"
        ? [{ commandId: event.commandId, playerId: event.playerId, reason: event.reason }]
        : [],
    );
}

describe("tick-boundary MOVE validation", () => {
  it("rejects MOVE whose Controller was released after enqueue and before apply", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const unit = controlledUnit(world, 0);
    world.drainEvents();

    world.enqueueCommand(move(0, "queued-while-controlled", [unit], { x: 5, y: 0 }));
    world.releaseControlForPlayer(0);
    world.step();

    expect(world.drainEvents()).toEqual([
      {
        type: "COMMAND_REJECTED",
        commandId: "queued-while-controlled",
        playerId: 0,
        reason: "not_your_unit",
        tick: 0,
      },
    ]);
    expect(world.positions.get(unit)).toEqual({ x: 0, y: 0 });
    expect(world.movements.has(unit)).toBe(false);
    expect(world.owners.get(unit)).toEqual({ ownerPlayerId: 0 });
  });

  it("checks reasons in order: empty, bounds, controller, valid entities", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const own = controlledUnit(world, 0);
    const foreign = controlledUnit(world, 1);
    const unplaced = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
    world.controllers.set(unplaced, { controllerPlayerId: 0 });
    world.drainEvents();

    world.enqueueCommand(move(0, "empty", [], { x: 100, y: 0 }));
    world.enqueueCommand(move(0, "oob-foreign", [foreign], { x: 100, y: 0 }));
    world.enqueueCommand(move(0, "foreign", [foreign]));
    world.enqueueCommand(move(0, "missing", [999]));
    world.enqueueCommand(move(0, "unplaced", [unplaced]));
    world.enqueueCommand(move(0, "ok", [own]));
    world.step();

    expect(rejections(world)).toEqual([
      { commandId: "empty", playerId: 0, reason: "empty_entity_ids" },
      { commandId: "oob-foreign", playerId: 0, reason: "out_of_bounds" },
      { commandId: "foreign", playerId: 0, reason: "not_your_unit" },
      { commandId: "missing", playerId: 0, reason: "not_your_unit" },
      { commandId: "unplaced", playerId: 0, reason: "no_valid_entities" },
    ]);
    expect(world.movements.has(own)).toBe(true);
    expect(world.movements.has(foreign)).toBe(false);
  });

  it("validates MOVE targets against half-open MapDefinition bounds", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const unit = controlledUnit(world, 0);
    world.drainEvents();
    world.enqueueCommand(move(0, "min-edge", [unit], { x: -20, y: -20 }));
    world.enqueueCommand(move(0, "inside-max", [unit], { x: 19.999, y: 19.999 }));
    world.enqueueCommand(move(0, "max-x", [unit], { x: 20, y: 0 }));
    world.enqueueCommand(move(0, "max-y", [unit], { x: 0, y: 20 }));
    world.enqueueCommand(move(0, "below-min", [unit], { x: -20.001, y: 0 }));
    world.step();
    expect(rejections(world)).toEqual([
      { commandId: "max-x", playerId: 0, reason: "out_of_bounds" },
      { commandId: "max-y", playerId: 0, reason: "out_of_bounds" },
      { commandId: "below-min", playerId: 0, reason: "out_of_bounds" },
    ]);
  });

  it("skips the bounds check when the world has no map", () => {
    const world = createWorld({ seed: 1 });
    const unit = controlledUnit(world, 0);
    world.drainEvents();
    world.enqueueCommand(move(0, "far", [unit], { x: 1000, y: 0 }));
    world.step();
    expect(rejections(world)).toEqual([]);
    expect(world.movements.get(unit)?.targetX).toBe(1000);
  });

  it("checks Controller against the actor of each queued command", () => {
    const world = createWorld({ seed: 1, map: FOUNDATION_MAP });
    const unit = controlledUnit(world, 0);
    world.drainEvents();
    world.enqueueCommand(move(1, "other-player", [unit]));
    world.enqueueCommand(move(0, "owner", [unit]));
    world.step();
    expect(rejections(world)).toEqual([
      { commandId: "other-player", playerId: 1, reason: "not_your_unit" },
    ]);
  });
});
