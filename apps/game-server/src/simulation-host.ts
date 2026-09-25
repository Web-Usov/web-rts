import { isWithinFoundationBounds } from "@web-rts/game-data";
import type { GameCommand } from "@web-rts/protocol";
import { createWorld, type SimulationCommand, type World } from "@web-rts/simulation";
import { mapGameCommandToSimulation, type SessionPlayerContext } from "./command-mapper.js";
import { PrimitiveUnitRegistry } from "./primitive-units.js";

export type SimulationHostOptions = {
  seed: number;
  mapId: string;
};

export type EnqueueResult =
  { ok: true; command: SimulationCommand } | { ok: false; reason: string };

/**
 * Application-boundary wrapper around `@web-rts/simulation`.
 * Colyseus Room talks to this host — never to World internals as gameplay authority.
 */
export class SimulationHost {
  readonly seed: number;
  readonly mapId: string;
  readonly world: World;
  readonly primitiveUnits = new PrimitiveUnitRegistry();

  constructor(options: SimulationHostOptions) {
    this.seed = options.seed;
    this.mapId = options.mapId;
    this.world = createWorld({ seed: options.seed });
  }

  /**
   * Spawns F5 primitive units for the given server-derived player ids.
   * Call once when leaving LOBBY.
   */
  bootstrapMatch(playerIds: readonly number[]): void {
    this.primitiveUnits.spawnForPlayers(this.world, playerIds);
  }

  /**
   * Validates session identity, F5 unit binding, and map bounds, then maps
   * protocol → simulation and enqueues on the world command queue.
   */
  enqueueFromSession(command: GameCommand, context: SessionPlayerContext): EnqueueResult {
    if (!isWithinFoundationBounds(command.target)) {
      return { ok: false, reason: "out_of_bounds" };
    }

    if (!this.primitiveUnits.canControlEntities(context.playerId, command.entityIds)) {
      return { ok: false, reason: "not_your_unit" };
    }

    const mapped = mapGameCommandToSimulation(command, context);
    this.world.enqueueCommand(mapped);
    return { ok: true, command: mapped };
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
