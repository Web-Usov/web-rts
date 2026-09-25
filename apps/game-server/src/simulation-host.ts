import { createWorld, type SimulationCommand, type World } from "@web-rts/simulation";
import { mapGameCommandToSimulation, type SessionPlayerContext } from "./command-mapper.js";
import type { GameCommand } from "@web-rts/protocol";

export type SimulationHostOptions = {
  seed: number;
  mapId: string;
};

/**
 * Application-boundary wrapper around `@web-rts/simulation`.
 * Colyseus Room talks to this host — never to World internals as gameplay authority.
 */
export class SimulationHost {
  readonly seed: number;
  readonly mapId: string;
  readonly world: World;

  constructor(options: SimulationHostOptions) {
    this.seed = options.seed;
    this.mapId = options.mapId;
    this.world = createWorld({ seed: options.seed });
  }

  /**
   * Validates that identity comes from session context, maps protocol → simulation,
   * and enqueues on the world command queue (applied on next tick boundary).
   */
  enqueueFromSession(command: GameCommand, context: SessionPlayerContext): SimulationCommand {
    const mapped = mapGameCommandToSimulation(command, context);
    this.world.enqueueCommand(mapped);
    return mapped;
  }

  /** Direct enqueue for already-mapped commands (used by unit tests). */
  enqueue(command: SimulationCommand): void {
    this.world.enqueueCommand(command);
  }

  step(): void {
    this.world.step();
  }

  get tick(): number {
    return this.world.tick;
  }

  pendingCommandCount(): number {
    return this.world.pendingCommandCount();
  }
}
