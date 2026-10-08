import type { SimulationCommand } from "./commands.js";
import type { PlayerId } from "./types.js";

/** Future cost contract only: these are not implemented gameplay/wire commands. */
type PathCostIntent =
  | Pick<SimulationCommand, "type" | "entityIds">
  | { readonly type: "GATHER" | "BUILD" | "GARRISON" | "UNGARRISON" };

export function commandPathCost(command: PathCostIntent): number {
  switch (command.type) {
    case "MOVE":
      return command.entityIds.length;
    case "UNGARRISON":
      return 0;
    default:
      return 1;
  }
}

/** Internal selector. Reservation happens before any gameplay inspection. */
export function scheduleCommands<T>(
  queues: ReadonlyMap<PlayerId, T[]>,
  nextPlayerId: PlayerId | undefined,
  maxCommands: number,
  pathBudget: number,
  costOf: (command: T) => number,
): {
  selected: Array<{ playerId: PlayerId; command: T }>;
  nextPlayerId: PlayerId | undefined;
  reservedCost: number;
} {
  const ids = [...queues.keys()].sort((a, b) => a - b);
  const selected: Array<{ playerId: PlayerId; command: T }> = [];
  if (ids.length === 0) return { selected, nextPlayerId: undefined, reservedCost: 0 };
  // A removed cursor resolves to its ascending successor, wrapping at the end.
  const successor = nextPlayerId === undefined ? 0 : ids.findIndex((id) => id >= nextPlayerId);
  const start = successor < 0 ? 0 : successor;
  let remaining = pathBudget;
  while (selected.length < maxCommands) {
    let progress = false;
    for (let offset = 0; offset < ids.length && selected.length < maxCommands; offset += 1) {
      const playerId = ids[(start + offset) % ids.length]!;
      const queue = queues.get(playerId)!;
      const head = queue[0];
      if (head === undefined) continue;
      const cost = costOf(head);
      if (cost > remaining) continue;
      remaining -= cost;
      selected.push({ playerId, command: queue.shift()! });
      progress = true;
    }
    if (!progress) break;
  }
  // Rotate the start once per tick, including ticks with no schedulable heads.
  return {
    selected,
    nextPlayerId: ids[(start + 1) % ids.length],
    reservedCost: pathBudget - remaining,
  };
}
