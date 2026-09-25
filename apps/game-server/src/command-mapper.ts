import type { GameCommand } from "@web-rts/protocol";
import type { SimulationCommand } from "@web-rts/simulation";

/**
 * Session-derived player context. Built only from Colyseus session/slot data —
 * never from client command payload fields.
 */
export type SessionPlayerContext = {
  playerId: number;
  sessionId: string;
};

/**
 * Explicit protocol → simulation boundary (audit #25 / Finding I1).
 *
 * - Drops transport-only fields such as `clientSequence`.
 * - Does not forward any client-supplied identity.
 * - `context.playerId` is available for future controller checks (F6) without
 *   entering the simulation command shape until permissions are implemented.
 */
export function mapGameCommandToSimulation(
  command: GameCommand,
  context: SessionPlayerContext,
): SimulationCommand {
  // Session identity stays at the host boundary; SimulationCommand has no playerId (F6).
  void context.playerId;
  void context.sessionId;

  // Foundation vertical slice: MOVE only. Extend with new branches as protocol grows.
  return {
    type: "MOVE",
    commandId: command.commandId,
    entityIds: [...command.entityIds],
    target: {
      x: command.target.x,
      y: command.target.y,
    },
  };
}

/**
 * Returns true when a mapped simulation command still carries a transport-only
 * field that must never cross the boundary (guard for tests / regressions).
 */
export function simulationCommandHasTransportFields(
  command: SimulationCommand & Record<string, unknown>,
): boolean {
  return Object.hasOwn(command, "clientSequence") || Object.hasOwn(command, "playerId");
}
