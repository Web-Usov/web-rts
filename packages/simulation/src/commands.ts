import type { EntityId, PlayerId, Vec2 } from "./types.js";

/**
 * Gameplay intent accepted by the simulation kernel.
 * It carries no player/session identity: the trusted actor travels next to it
 * in {@link QueuedCommand}.
 */
export type SimulationCommand =
  | {
      type: "MOVE";
      commandId: string;
      entityIds: readonly EntityId[];
      target: Vec2;
    }
  | {
      type: "GATHER";
      commandId: string;
      workerEntityId: EntityId;
      resourceEntityId: EntityId;
    };

/** Trusted issuer of a command. Derived by the host from session/local identity. */
export type CommandActor = {
  readonly playerId: PlayerId;
};

export type QueuedCommand = {
  readonly actor: CommandActor;
  readonly command: SimulationCommand;
};

/** Stable machine-readable reasons produced by tick-boundary validation. */
export type CommandRejectionReason =
  | "empty_entity_ids"
  | "out_of_bounds"
  | "blocked_target"
  | "not_your_unit"
  | "no_valid_entities"
  | "no_path"
  | "no_dropoff"
  | "invalid_resource"
  | "not_worker";

export class CommandQueue {
  private readonly pending: QueuedCommand[] = [];

  enqueue(queued: QueuedCommand): void {
    this.pending.push(queued);
  }

  /** Drain all commands queued since the previous tick boundary. */
  drain(): QueuedCommand[] {
    if (this.pending.length === 0) {
      return [];
    }
    return this.pending.splice(0, this.pending.length);
  }

  get size(): number {
    return this.pending.length;
  }
}
