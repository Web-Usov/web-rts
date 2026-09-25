import { MAX_PLAYERS } from "./constants.js";

export type PlayerSlot = {
  playerId: number;
  sessionId: string;
  connected: boolean;
};

/**
 * Assigns compact numeric playerIds to Colyseus sessions.
 * Identity is server-owned — never taken from client command payloads.
 */
export class PlayerSlotRegistry {
  private readonly bySession = new Map<string, PlayerSlot>();
  private readonly byPlayerId = new Map<number, PlayerSlot>();
  private nextPlayerId = 0;

  get size(): number {
    return this.bySession.size;
  }

  get connectedCount(): number {
    let count = 0;
    for (const slot of this.bySession.values()) {
      if (slot.connected) {
        count += 1;
      }
    }
    return count;
  }

  list(): readonly PlayerSlot[] {
    return [...this.byPlayerId.values()].sort((a, b) => a.playerId - b.playerId);
  }

  getBySessionId(sessionId: string): PlayerSlot | undefined {
    return this.bySession.get(sessionId);
  }

  /**
   * Allocates a new slot for a joining session.
   * Returns undefined when the room is at capacity (should not happen if maxClients is set).
   */
  allocate(sessionId: string): PlayerSlot | undefined {
    if (this.bySession.has(sessionId)) {
      return this.bySession.get(sessionId);
    }
    if (this.byPlayerId.size >= MAX_PLAYERS) {
      return undefined;
    }

    const playerId = this.nextPlayerId;
    this.nextPlayerId += 1;
    const slot: PlayerSlot = { playerId, sessionId, connected: true };
    this.bySession.set(sessionId, slot);
    this.byPlayerId.set(playerId, slot);
    return slot;
  }

  markDisconnected(sessionId: string): void {
    const slot = this.bySession.get(sessionId);
    if (!slot) {
      return;
    }
    slot.connected = false;
  }

  /** Rebinds an existing player slot to a new session (reconnect path; F8 will expand). */
  rebindSession(playerId: number, sessionId: string): PlayerSlot | undefined {
    const slot = this.byPlayerId.get(playerId);
    if (!slot) {
      return undefined;
    }
    this.bySession.delete(slot.sessionId);
    slot.sessionId = sessionId;
    slot.connected = true;
    this.bySession.set(sessionId, slot);
    return slot;
  }
}
