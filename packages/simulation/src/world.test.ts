import { describe, expect, it } from "vitest";
import { DEFAULT_TICK_HZ, createWorld } from "./index.js";
import { createSeededRng } from "./rng.js";

describe("simulation kernel", () => {
  it("uses fixed 10 Hz tick by default", () => {
    const world = createWorld({ seed: 1 });
    expect(world.config.tickHz).toBe(DEFAULT_TICK_HZ);
    expect(world.config.tickDurationSeconds).toBe(0.1);
  });

  it("advances only via explicit fixed ticks", () => {
    const world = createWorld({ seed: 1 });
    expect(world.tick).toBe(0);
    world.step();
    expect(world.tick).toBe(1);
    world.stepN(4);
    expect(world.tick).toBe(5);
  });

  it("applies commands on tick boundaries, not immediately", () => {
    const world = createWorld({ seed: 1 });
    const entityId = world.createEntity();
    world.positions.set(entityId, { x: 0, y: 0 });
    world.drainEvents();

    world.enqueueCommand({
      type: "MOVE",
      commandId: "move-1",
      entityIds: [entityId],
      target: { x: 10, y: 0 },
    });

    expect(world.movements.has(entityId)).toBe(false);
    expect(world.positions.get(entityId)).toEqual({ x: 0, y: 0 });
    expect(world.pendingCommandCount()).toBe(1);

    world.step();

    expect(world.pendingCommandCount()).toBe(0);
    expect(world.movements.has(entityId)).toBe(true);
    const position = world.positions.get(entityId);
    expect(position).toBeDefined();
    expect(position!.x).toBeGreaterThan(0);
    expect(position!.x).toBeLessThan(10);

    const events = world.drainEvents();
    expect(events).toContainEqual({
      type: "COMMAND_APPLIED",
      commandId: "move-1",
      tick: 0,
    });
  });

  it("moves an entity toward the MOVE target over ticks", () => {
    const world = createWorld({ seed: 7, defaultMoveSpeed: 5 });
    const entityId = world.createEntity();
    world.positions.set(entityId, { x: 0, y: 0 });
    world.enqueueCommand({
      type: "MOVE",
      commandId: "move-2",
      entityIds: [entityId],
      target: { x: 2, y: 0 },
    });

    // speed 5 u/s * 0.1 s = 0.5 units/tick → 4 ticks to reach x=2
    world.stepN(4);

    expect(world.positions.get(entityId)).toEqual({ x: 2, y: 0 });
    expect(world.movements.has(entityId)).toBe(false);
  });

  it("produces the same result for the same seed, state, and commands", () => {
    const run = (): { tick: number; x: number; y: number; samples: number[] } => {
      const world = createWorld({ seed: 42 });
      const entityId = world.createEntity();
      world.positions.set(entityId, { x: 0, y: 0 });
      world.enqueueCommand({
        type: "MOVE",
        commandId: "repeat",
        entityIds: [entityId],
        target: { x: 3, y: 4 },
      });
      world.stepN(20);
      const position = world.positions.get(entityId)!;
      return {
        tick: world.tick,
        x: position.x,
        y: position.y,
        samples: [world.rng.next(), world.rng.next(), world.rng.next()],
      };
    };

    expect(run()).toEqual(run());
  });
});

describe("seeded RNG", () => {
  it("is repeatable for the same seed", () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    const sequenceA = Array.from({ length: 8 }, () => a.next());
    const sequenceB = Array.from({ length: 8 }, () => b.next());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("diverges for different seeds", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    expect(a.next()).not.toBe(b.next());
  });
});
