import type { CommandRejectionReason } from "./commands.js";
import type { EntityId, PlayerId } from "./types.js";

export type SimulationEvent =
  | {
      type: "COMMAND_APPLIED";
      commandId: string;
      playerId: PlayerId;
      tick: number;
    }
  | {
      type: "COMMAND_REJECTED";
      commandId: string;
      playerId: PlayerId;
      reason: CommandRejectionReason;
      tick: number;
    }
  | {
      type: "ENTITY_SPAWNED";
      entityId: EntityId;
      tick: number;
    };

export class EventQueue {
  private readonly events: SimulationEvent[] = [];

  push(event: SimulationEvent): void {
    this.events.push(event);
  }

  /** Return accumulated events and clear the queue. */
  drain(): SimulationEvent[] {
    if (this.events.length === 0) {
      return [];
    }
    return this.events.splice(0, this.events.length);
  }

  get size(): number {
    return this.events.length;
  }
}
