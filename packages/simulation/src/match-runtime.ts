import { FOUNDATION_MAP } from "@web-rts/game-data";
import type { CommandActor, CommandRejectionReason, SimulationCommand } from "./commands.js";
import { commandPathCost, scheduleCommands } from "./command-scheduler.js";
import { positiveInteger, type CreateWorldOptions } from "./config.js";
import {
  placeStartingStructures,
  spawnPlayerUnits,
  spawnStartingEconomy,
} from "./foundation-match.js";
import { readWorldEntities, type MatchEntitySnapshot } from "./snapshot.js";
import type { EntityId, PlayerEconomy, PlayerId } from "./types.js";
import { createWorld, type World } from "./world.js";

export type MatchParticipant = {
  readonly playerId: PlayerId;
};

/** Trusted setup resolved by the host shell when leaving its lobby. */
export type MatchSetup = {
  readonly seed: number;
  readonly mapId: string;
  readonly participants: readonly MatchParticipant[];
};

/** Gameplay lifecycle owned by the runtime. LOBBY/STARTING stay in the shells. */
export type MatchStatus = "RUNNING" | "FINISHED";

/**
 * Default per-player pending command cap (Spec #002 §8.8, §22.13).
 * Shared by Local and Remote; the Remote room rate limit is an extra guard only.
 */
export const DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER = 32;
export const DEFAULT_MAX_COMMANDS_PER_TICK = 16;

/** Host-owned runtime limits. Not part of the trusted gameplay setup. */
export type RuntimeConfig = {
  readonly maxPendingCommandsPerPlayer: number;
  readonly maxCommandsPerTick: number;
};

/**
 * `queue_full` is backpressure: the command was not enqueued and World state
 * was not read. Already queued commands are never evicted.
 */
export type CommandAdmissionRejection = "not_participant" | "not_running" | "queue_full";

export type CommandAdmission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: CommandAdmissionRejection };

/** Transport-neutral event addressed to one player. Shells only deliver it. */
export type RuntimeEvent =
  | {
      readonly type: "COMMAND_REJECTED";
      readonly recipientPlayerId: PlayerId;
      readonly commandId: string;
      readonly reason: CommandRejectionReason;
      readonly tick: number;
    }
  | {
      readonly type: "ACTION_FAILED";
      readonly recipientPlayerId: PlayerId;
      readonly commandId: string;
      readonly entityId: EntityId;
      readonly action: "GATHER";
      readonly reason: import("./events.js").ActionFailureReason;
      readonly tick: number;
    };

export type MatchSnapshot = {
  readonly tick: number;
  readonly status: MatchStatus;
  readonly entities: readonly MatchEntitySnapshot[];
  readonly playerEconomies: readonly (PlayerEconomy & { readonly playerId: PlayerId })[];
};

export type RuntimeMetrics = {
  readonly tick: number;
  readonly entityCount: number;
  readonly pendingCommandCount: number;
  readonly processedCommands: number;
  readonly reservedCommandPathCost: number;
  readonly commandBudgetUsed: number;
  readonly commandBudgetRemaining: number;
  readonly activeTaskQueries: number;
  readonly aiQueries: number;
};

/**
 * Production facade of gameplay execution shared by the Remote room and the
 * Local worker. It has no timers: the host scheduler calls {@link MatchRuntime.step}.
 */
export interface MatchRuntime {
  readonly status: MatchStatus;
  /**
   * Admits a trusted command into the actor's FIFO queue. Gameplay validation
   * happens later, on the tick boundary.
   */
  submitCommand(actor: CommandActor, command: SimulationCommand): CommandAdmission;
  /** Schedules pending commands into the World, runs systems, drains World events. */
  step(): void;
  drainEvents(): RuntimeEvent[];
  readSnapshot(): MatchSnapshot;
  readMetrics(): RuntimeMetrics;
  /**
   * Permanent leave/timeout: discards the player's not-yet-applied commands,
   * removes participation, releases Controller. Emits no events.
   */
  removePlayer(playerId: PlayerId): void;
}

export function resolveRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const maxPendingCommandsPerPlayer =
    overrides.maxPendingCommandsPerPlayer ?? DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER;
  positiveInteger(maxPendingCommandsPerPlayer, "maxPendingCommandsPerPlayer");
  const maxCommandsPerTick = positiveInteger(
    overrides.maxCommandsPerTick ?? DEFAULT_MAX_COMMANDS_PER_TICK,
    "maxCommandsPerTick",
  );
  return { maxPendingCommandsPerPlayer, maxCommandsPerTick };
}

export function createMatchRuntime(
  setup: MatchSetup,
  config: Partial<RuntimeConfig> = {},
  simulationOptions: Pick<CreateWorldOptions, "pathQueriesPerTick" | "maxPathQueriesPerTick"> = {},
): MatchRuntime {
  return new FoundationMatchRuntime(setup, resolveRuntimeConfig(config), simulationOptions);
}

class FoundationMatchRuntime implements MatchRuntime {
  private readonly world: World;
  /** Per-player FIFO ingress. Key presence means the player still participates. */
  private readonly queues = new Map<PlayerId, SimulationCommand[]>();
  private nextCommandPlayerId: PlayerId | undefined;
  private processedCommands = 0;
  private reservedCommandPathCost = 0;
  private readonly outbox: RuntimeEvent[] = [];

  constructor(
    setup: MatchSetup,
    private readonly config: RuntimeConfig,
    simulationOptions: Pick<CreateWorldOptions, "pathQueriesPerTick" | "maxPathQueriesPerTick">,
  ) {
    // #002 has one fixed MapDefinition. Selecting it by mapId waits for mapId on the
    // wire (G11); shells still pass arbitrary ids, so they must not change the layout.
    const map = FOUNDATION_MAP;
    this.world = createWorld({ ...simulationOptions, seed: setup.seed, map });
    const playerIds = setup.participants.map((participant) => participant.playerId);
    for (const playerId of playerIds) {
      this.queues.set(playerId, []);
    }
    spawnPlayerUnits(this.world, map, playerIds);
    placeStartingStructures(this.world, map);
    spawnStartingEconomy(this.world, map, playerIds);
    this.world.drainEvents();
  }

  get status(): MatchStatus {
    return "RUNNING";
  }

  submitCommand(actor: CommandActor, command: SimulationCommand): CommandAdmission {
    if (this.status !== "RUNNING") {
      return { accepted: false, reason: "not_running" };
    }
    const queue = this.queues.get(actor.playerId);
    if (queue === undefined) {
      return { accepted: false, reason: "not_participant" };
    }
    if (queue.length >= this.config.maxPendingCommandsPerPlayer) {
      return { accepted: false, reason: "queue_full" };
    }
    queue.push(command);
    return { accepted: true };
  }

  step(): void {
    if (this.status !== "RUNNING") {
      return;
    }
    const schedule = scheduleCommands(
      this.queues,
      this.nextCommandPlayerId,
      this.config.maxCommandsPerTick,
      this.world.config.pathQueriesPerTick.commandBudget,
      commandPathCost,
    );
    this.nextCommandPlayerId = schedule.nextPlayerId;
    this.processedCommands = schedule.selected.length;
    this.reservedCommandPathCost = schedule.reservedCost;
    for (const { playerId, command } of schedule.selected) {
      this.world.enqueueCommand({ actor: { playerId }, command });
    }
    this.world.step();
    for (const event of this.world.drainEvents()) {
      if (event.type === "ACTION_FAILED") {
        this.outbox.push({
          type: event.type,
          recipientPlayerId: event.playerId,
          commandId: event.commandId,
          entityId: event.entityId,
          action: event.action,
          reason: event.reason,
          tick: event.tick,
        });
        continue;
      }
      if (event.type !== "COMMAND_REJECTED") {
        continue;
      }
      this.outbox.push({
        type: "COMMAND_REJECTED",
        recipientPlayerId: event.playerId,
        commandId: event.commandId,
        reason: event.reason,
        tick: event.tick,
      });
    }
  }

  drainEvents(): RuntimeEvent[] {
    return this.outbox.splice(0, this.outbox.length);
  }

  readSnapshot(): MatchSnapshot {
    return {
      tick: this.world.tick,
      status: this.status,
      entities: readWorldEntities(this.world),
      playerEconomies: [...this.world.playerEconomies.entries()]
        .sort(([a], [b]) => a - b)
        .map(([playerId, economy]) => ({ playerId, resources: { ...economy.resources } })),
    };
  }

  readMetrics(): RuntimeMetrics {
    let pendingCommandCount = this.world.pendingCommandCount();
    for (const queue of this.queues.values()) {
      pendingCommandCount += queue.length;
    }
    return {
      tick: this.world.tick,
      entityCount: this.world.entityIds().length,
      pendingCommandCount,
      processedCommands: this.processedCommands,
      reservedCommandPathCost: this.reservedCommandPathCost,
      commandBudgetUsed: this.reservedCommandPathCost,
      commandBudgetRemaining:
        this.world.config.pathQueriesPerTick.commandBudget - this.reservedCommandPathCost,
      ...this.world.readPathQueryMetrics(),
    };
  }

  removePlayer(playerId: PlayerId): void {
    this.queues.delete(playerId);
    for (let index = this.outbox.length - 1; index >= 0; index -= 1) {
      if (this.outbox[index]!.recipientPlayerId === playerId) {
        this.outbox.splice(index, 1);
      }
    }
    this.world.releaseControlForPlayer(playerId);
  }
}
