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
import {
  SpatialGrid,
  type FootprintPlacementRefusal,
  type SpatialFootprint,
} from "./spatial-grid.js";
import { runMovementSystem } from "./systems/movement.js";
import type {
  Controller,
  EntityId,
  EntityIdentity,
  Movement,
  Objective,
  ObjectiveId,
  Owner,
  PlayerId,
  Position,
} from "./types.js";

export type SolidPlacementRefusal = FootprintPlacementRefusal | "no_grid" | "unit_present";

export type SolidPlacement =
  { readonly ok: true } | { readonly ok: false; readonly reason: SolidPlacementRefusal };

/**
 * Framework-agnostic simulation world.
 * Advances only via explicit {@link World.step} / {@link World.stepN}.
 */
export class World {
  readonly config: SimulationConfig;
  readonly rng: Rng;
  /** Runtime grid of {@link SimulationConfig.map}; `null` when the world has no map. */
  readonly grid: SpatialGrid | null;
  readonly identities = new ComponentStore<EntityIdentity>();
  readonly positions = new ComponentStore<Position>();
  readonly movements = new ComponentStore<Movement>();
  readonly owners = new ComponentStore<Owner>();
  readonly controllers = new ComponentStore<Controller>();

  private tickCount = 0;
  private nextEntityId: EntityId = 1;
  private nextObjectiveId: ObjectiveId = 1;
  private readonly objectives = new Map<ObjectiveId, Objective>();
  private readonly living = new Set<EntityId>();
  private readonly commands = new CommandQueue();
  private readonly events = new EventQueue();

  constructor(options: CreateWorldOptions = {}) {
    this.config = resolveSimulationConfig(options);
    this.rng = createSeededRng(this.config.seed);
    this.grid = this.config.map === null ? null : new SpatialGrid(this.config.map);
  }

  /** Completed tick count. Starts at 0 before any step. */
  get tick(): number {
    return this.tickCount;
  }

  createEntity(identity: EntityIdentity): EntityId {
    const entityId = this.nextEntityId;
    this.nextEntityId += 1;
    this.living.add(entityId);
    this.identities.set(entityId, { kind: identity.kind, definitionId: identity.definitionId });
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
    this.grid?.removeFootprint(entityId);
    this.identities.remove(entityId);
    this.positions.remove(entityId);
    this.movements.remove(entityId);
    this.owners.remove(entityId);
    this.controllers.remove(entityId);
  }

  hasEntity(entityId: EntityId): boolean {
    return this.living.has(entityId);
  }

  entityIds(): readonly EntityId[] {
    return [...this.living];
  }

  /**
   * Assigns a generic objective role. The objective outlives its target entity:
   * resolving a destroyed PROTECT target is match-result logic, not entity cleanup.
   */
  addObjective(objective: Objective): ObjectiveId {
    if (!this.living.has(objective.targetEntityId)) {
      throw new RangeError(`objective target ${objective.targetEntityId} is not a living entity`);
    }
    const objectiveId = this.nextObjectiveId;
    this.nextObjectiveId += 1;
    this.objectives.set(objectiveId, { ...objective });
    return objectiveId;
  }

  getObjective(objectiveId: ObjectiveId): Objective | undefined {
    return this.objectives.get(objectiveId);
  }

  /** Ascending objective id order. */
  objectiveEntries(): Array<readonly [ObjectiveId, Objective]> {
    return [...this.objectives.entries()];
  }

  /**
   * Placement validation for a new solid footprint: grid bounds, static terrain,
   * existing solid occupancy and current unit cells (Spec #002 §7.5).
   */
  canPlaceSolidFootprint(footprint: SpatialFootprint): SolidPlacement {
    if (this.grid === null) {
      return { ok: false, reason: "no_grid" };
    }
    const placement = this.grid.canPlaceFootprint(footprint);
    if (!placement.ok) {
      return placement;
    }
    const covered = new Set(
      this.grid.footprintCells(footprint).map((cell) => this.grid!.cellId(cell)),
    );
    for (const [entityId, identity] of this.identities.entries()) {
      const position = this.positions.get(entityId);
      if (identity.kind !== "UNIT" || position === undefined) {
        continue;
      }
      const cell = this.grid.worldToCell(position);
      if (this.grid.isCellInBounds(cell) && covered.has(this.grid.cellId(cell))) {
        return { ok: false, reason: "unit_present" };
      }
    }
    return { ok: true };
  }

  /** Registers a living entity's solid footprint after {@link canPlaceSolidFootprint}. */
  placeSolidFootprint(entityId: EntityId, footprint: SpatialFootprint): SolidPlacement {
    if (!this.living.has(entityId)) {
      throw new RangeError(`cannot place a footprint for missing entity ${entityId}`);
    }
    const placement = this.canPlaceSolidFootprint(footprint);
    if (!placement.ok) {
      return placement;
    }
    return this.grid!.addFootprint(entityId, footprint);
  }

  /** Removes the entity's solid footprint. No-op (no topology change) when absent. */
  removeSolidFootprint(entityId: EntityId): boolean {
    return this.grid?.removeFootprint(entityId) ?? false;
  }

  /** Monotonic solid-topology counter; 0 without a grid. Internal, not replicated. */
  get topologyRevision(): number {
    return this.grid?.topologyRevision ?? 0;
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
   * Does not destroy entities, Owner, or objectives.
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
    if (this.grid !== null && !this.grid.containsWorldPoint(command.target)) {
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
