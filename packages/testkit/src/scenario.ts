import {
  createWorld,
  type CreateWorldOptions,
  type SimulationCommand,
  type World,
} from "@web-rts/simulation";

export interface ScenarioCommandAtTick {
  /** Tick value observed on the world before the corresponding step. */
  atTick: number;
  command: SimulationCommand;
}

export interface RunScenarioOptions {
  seed?: number;
  tickHz?: number;
  defaultMoveSpeed?: number;
  setup?: (world: World) => void;
  commands?: readonly ScenarioCommandAtTick[];
  ticks: number;
}

/** Build a simulation world with test-friendly defaults. */
export function createTestWorld(options: CreateWorldOptions = {}): World {
  return createWorld({
    ...options,
    seed: options.seed ?? 1,
  });
}

/**
 * Deterministic scenario helper:
 * seed + initial world + ordered commands + N ticks.
 */
export function runScenario(options: RunScenarioOptions): World {
  const createOptions: CreateWorldOptions = {
    seed: options.seed ?? 1,
  };
  if (options.tickHz !== undefined) {
    createOptions.tickHz = options.tickHz;
  }
  if (options.defaultMoveSpeed !== undefined) {
    createOptions.defaultMoveSpeed = options.defaultMoveSpeed;
  }

  const world = createTestWorld(createOptions);
  options.setup?.(world);

  const scheduled = [...(options.commands ?? [])].sort((a, b) => a.atTick - b.atTick);
  let commandIndex = 0;

  for (let i = 0; i < options.ticks; i += 1) {
    while (commandIndex < scheduled.length && scheduled[commandIndex]!.atTick === world.tick) {
      world.enqueueCommand(scheduled[commandIndex]!.command);
      commandIndex += 1;
    }
    world.step();
  }

  return world;
}

export function spawnUnit(world: World, position: { x: number; y: number }): number {
  const entityId = world.createEntity();
  world.positions.set(entityId, position);
  return entityId;
}
