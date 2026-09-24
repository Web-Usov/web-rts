import type { EntityId, Vec2 } from "./types.js";

/** Commands accepted by the simulation kernel (F1: MOVE only). */
export type SimulationCommand = {
  type: "MOVE";
  commandId: string;
  entityIds: readonly EntityId[];
  target: Vec2;
};

export class CommandQueue {
  private readonly pending: SimulationCommand[] = [];

  enqueue(command: SimulationCommand): void {
    this.pending.push(command);
  }

  /** Drain all commands queued since the previous tick boundary. */
  drain(): SimulationCommand[] {
    if (this.pending.length === 0) {
      return [];
    }
    return this.pending.splice(0, this.pending.length);
  }

  get size(): number {
    return this.pending.length;
  }
}
