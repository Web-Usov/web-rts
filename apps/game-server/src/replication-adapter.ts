import type { World } from "@web-rts/simulation";
import {
  projectWorldToGameStateView as projectSharedWorld,
  type GameStateView,
  type MatchPhase,
  type ReplicationPlayerSlot,
} from "@web-rts/protocol";

export type { ReplicationPlayerSlot };

export type ReplicationAdapterInput = {
  world: World | null;
  roomId: string;
  phase: MatchPhase;
  /** Recipient session player id (per-client projection hook for ADR-007). */
  localPlayerId: number;
  players: readonly ReplicationPlayerSlot[];
};

/**
 * Projects simulation World → protocol GameStateView.
 * The projection itself is shared with LocalGameTransport via `@web-rts/protocol`
 * so remote and local clients receive the same DTO. This module stays the
 * multiplayer call site and does not import Colyseus or Babylon (ADR-007).
 */
export function projectWorldToGameStateView(input: ReplicationAdapterInput): GameStateView {
  return projectSharedWorld(input);
}
