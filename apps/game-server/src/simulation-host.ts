import type { GameCommand } from "@web-rts/protocol";
import {
  assessFoundationMove,
  createWorld,
  placeFoundationObjective,
  type SimulationCommand,
  type World,
} from "@web-rts/simulation";
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
    placeFoundationObjective(this.world);
  }

  /**
   * Validates session identity, Controller permission, and map bounds, then maps
   * protocol → simulation and enqueues on the world command queue.
   */
  enqueueFromSession(command: GameCommand, context: SessionPlayerContext): EnqueueResult {
    const decision = assessFoundationMove(
      this.world,
      context.playerId,
      command.entityIds,
      command.target,
    );
    if (!decision.ok) {
      return decision;
    }

    const mapped = mapGameCommandToSimulation(command, context);
    this.world.enqueueCommand(mapped);
    return { ok: true, command: mapped };
  }

  /** Direct enqueue for already-mapped commands (used by unit tests). */
  enqueue(command: SimulationCommand): void {
    this.world.enqueueCommand(command);
  }

  /**
   * Drops active control for one player after permanent leave.
   * Does not destroy entities, Owner, or Objective components.
   */
  releaseControlForPlayer(playerId: number): void {
    for (const [entityId, controller] of this.world.controllers.entries()) {
      if (controller.controllerPlayerId === playerId) {
        this.world.controllers.remove(entityId);
      }
    }
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
