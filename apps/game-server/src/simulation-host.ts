import { FOUNDATION_OBJECTIVE_POSITION, isWithinFoundationBounds } from "@web-rts/game-data";
import type { GameCommand } from "@web-rts/protocol";
import { canIssueMove, createWorld, type SimulationCommand, type World } from "@web-rts/simulation";
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
   * Spawns one primitive unit per player and exactly one map-center objective.
   * Call once when leaving LOBBY.
   */
  bootstrapMatch(playerIds: readonly number[]): void {
    this.primitiveUnits.spawnForPlayers(this.world, playerIds);
    const objectiveId = this.world.createEntity();
    this.world.positions.set(objectiveId, {
      x: FOUNDATION_OBJECTIVE_POSITION.x,
      y: FOUNDATION_OBJECTIVE_POSITION.y,
    });
    this.world.objectives.set(objectiveId, { type: "SACRED_SITE", state: "ACTIVE" });
  }

  /**
   * Validates session identity, Controller permission, and map bounds, then maps
   * protocol → simulation and enqueues on the world command queue.
   */
  enqueueFromSession(command: GameCommand, context: SessionPlayerContext): EnqueueResult {
    if (!isWithinFoundationBounds(command.target)) {
      return { ok: false, reason: "out_of_bounds" };
    }

    if (!canIssueMove(this.world, context.playerId, command.entityIds)) {
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
