import { isWithinFoundationBounds } from "@web-rts/game-data";
import {
  CommandQueue,
  type CommandRejectionReason,
  type QueuedCommand,
  type SimulationCommand,
} from "./commands.js";
import { ComponentStore } from "./component-store.js";
import {
  resolveSimulationConfig,
  type CreateWorldOptions,
  type SimulationConfig,
} from "./config.js";
import { EventQueue, type SimulationEvent } from "./events.js";
import { createSeededRng, type Rng } from "./rng.js";
import { runMovementSystem } from "./systems/movement.js";
import type {
  Controller,
  EntityId,
  Movement,
  Objective,
  Owner,
  PlayerId,
  Position,
} from "./types.js";

/**
 * Framework-agnostic simulation world.
 * Advances only via explicit {@link World.step} / {@link World.stepN}.
 */
export class World {
  readonly config: SimulationConfig;
  readonly rng: Rng;
  readonly positions = new ComponentStore<Position>();
  readonly movements = new ComponentStore<Movement>();
  readonly owners = new ComponentStore<Owner>();
  readonly controllers = new ComponentStore<Controller>();
  readonly objectives = new ComponentStore<Objective>();

  private tickCount = 0;
  private nextEntityId: EntityId = 1;
  private readonly living = new Set<EntityId>();
  private readonly commands = new CommandQueue();
  private readonly events = new EventQueue();

  constructor(options: CreateWorldOptions = {}) {
    this.config = resolveSimulationConfig(options);
    this.rng = createSeededRng(this.config.seed);
  }

  /** Completed tick count. Starts at 0 before any step. */
  get tick(): number {
    return this.tickCount;
  }

  createEntity(): EntityId {
    const entityId = this.nextEntityId;
    this.nextEntityId += 1;
    this.living.add(entityId);
    this.events.push({
      type: "ENTITY_SPAWNED",
      entityId,
      tick: this.tickCount,
    });
    return entityId;
  }

  destroyEntity(entityId: EntityId): void {
    if (!this.living.delete(entityId)) {
      return;
    }
    this.positions.remove(entityId);
    this.movements.remove(entityId);
    this.owners.remove(entityId);
    this.controllers.remove(entityId);
    this.objectives.remove(entityId);
  }

  hasEntity(entityId: EntityId): boolean {
    return this.living.has(entityId);
  }

  entityIds(): readonly EntityId[] {
    return [...this.living];
  }

  /**
   * Queue a trusted command. Gameplay validation (bounds, Controller) runs on the
   * next {@link World.step} tick boundary against the world state at that moment.
   */
  enqueueCommand(queued: QueuedCommand): void {
    this.commands.enqueue(queued);
  }

  /**
   * Drops active control for one player after permanent leave.
   * Does not destroy entities, Owner, or Objective components.
   */
  releaseControlForPlayer(playerId: PlayerId): void {
    for (const [entityId, controller] of this.controllers.entries()) {
      if (controller.controllerPlayerId === playerId) {
        this.controllers.remove(entityId);
      }
    }
  }

  pendingCommandCount(): number {
    return this.commands.size;
  }

  /**
   * Advance simulation by one fixed tick:
   * 1) apply queued commands
   * 2) run systems
   * 3) increment tick counter
   */
  step(): void {
    this.applyCommands();
    runMovementSystem(this.positions, this.movements, this.config.tickDurationSeconds);
    this.tickCount += 1;
  }

  stepN(count: number): void {
    if (count < 0) {
      throw new RangeError("stepN count must be non-negative");
    }
    for (let i = 0; i < count; i += 1) {
      this.step();
    }
  }

  drainEvents(): SimulationEvent[] {
    return this.events.drain();
  }

  private applyCommands(): void {
    const queued = this.commands.drain();
    for (const command of queued) {
      this.applyCommand(command);
    }
  }

  private applyCommand(queued: QueuedCommand): void {
    this.applyMoveCommand(queued.actor.playerId, queued.command);
  }

  private applyMoveCommand(
    playerId: PlayerId,
    command: Extract<SimulationCommand, { type: "MOVE" }>,
  ): void {
    const refusal = this.assessMove(playerId, command);
    if (refusal !== null) {
      this.events.push({
        type: "COMMAND_REJECTED",
        commandId: command.commandId,
        playerId,
        reason: refusal,
        tick: this.tickCount,
      });
      return;
    }

    let appliedAny = false;
    for (const entityId of command.entityIds) {
      if (!this.living.has(entityId) || !this.positions.has(entityId)) {
        continue;
      }
      this.movements.set(entityId, {
        targetX: command.target.x,
        targetY: command.target.y,
        speed: this.config.defaultMoveSpeed,
      });
      appliedAny = true;
    }

    if (!appliedAny) {
      this.events.push({
        type: "COMMAND_REJECTED",
        commandId: command.commandId,
        playerId,
        reason: "no_valid_entities",
        tick: this.tickCount,
      });
      return;
    }

    this.events.push({
      type: "COMMAND_APPLIED",
      commandId: command.commandId,
      playerId,
      tick: this.tickCount,
    });
  }

  /** Order matters: wire reasons are stable and parity-tested across Local/Remote. */
  private assessMove(
    playerId: PlayerId,
    command: Extract<SimulationCommand, { type: "MOVE" }>,
  ): CommandRejectionReason | null {
    if (command.entityIds.length === 0) {
      return "empty_entity_ids";
    }
    const bounds = this.config.mapBounds;
    if (bounds !== null && !isWithinFoundationBounds(command.target, bounds)) {
      return "out_of_bounds";
    }
    if (!canIssueMove(this, playerId, command.entityIds)) {
      return "not_your_unit";
    }
    return null;
  }
}

export function createWorld(options?: CreateWorldOptions): World {
  return new World(options);
}

/**
 * MOVE is allowed only when every target has a Controller whose player matches
 * the actor. Missing Controller (objectives, bare entities) rejects the whole
 * command. Owner is not consulted. Checked by World on the tick boundary.
 */
export function canIssueMove(
  world: World,
  playerId: PlayerId,
  entityIds: readonly EntityId[],
): boolean {
  if (entityIds.length === 0) {
    return false;
  }
  return entityIds.every((entityId) => {
    const controller = world.controllers.get(entityId);
    return controller !== undefined && controller.controllerPlayerId === playerId;
  });
}
