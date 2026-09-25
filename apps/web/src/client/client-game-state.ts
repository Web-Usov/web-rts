import type { GameEvent, GameStateView } from "@web-rts/protocol";
import {
  INTERPOLATION_DELAY_MS,
  sampleSnapshotBuffer,
  type InterpolatedPose,
  type StateSnapshot,
} from "./interpolation.js";

type StateListener = (poses: readonly InterpolatedPose[], view: GameStateView | null) => void;
type EventListener = (event: GameEvent) => void;

/**
 * Holds authoritative replicated snapshots and exposes interpolated poses for presentation.
 * Destination marker UX is intentionally separate and never mutates entity authority.
 */
const MAX_SNAPSHOTS = 8;

export class ClientGameState {
  private readonly snapshots: StateSnapshot[] = [];
  private view: GameStateView | null = null;
  private destinationSim: { x: number; y: number } | null = null;
  private selectedIds: number[] = [];
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private renderTimeMs = 0;

  applyAuthoritativeState(view: GameStateView, timeMs: number): void {
    this.view = view;
    const snapshot: StateSnapshot = {
      tick: view.tick,
      timeMs,
      entities: view.entities.map((entity) => ({
        entityId: entity.entityId,
        x: entity.x,
        y: entity.y,
        kind: entity.kind,
        ownerPlayerId: entity.ownerPlayerId,
        controllerPlayerId: entity.controllerPlayerId,
      })),
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.shift();
    }

    this.selectedIds = this.selectedIds.filter((id) =>
      view.entities.some((entity) => entity.entityId === id),
    );
    this.emitState();
  }

  /** Advances the interpolation clock used by {@link sample}. */
  setRenderTimeMs(timeMs: number): void {
    this.renderTimeMs = timeMs;
  }

  /**
   * Poses at `renderTimeMs - INTERPOLATION_DELAY_MS`.
   * Playing on the newest snapshot snaps once per tick; the delay spends the
   * gap between arrivals interpolating.
   */
  sample(renderTimeMs: number = this.renderTimeMs): readonly InterpolatedPose[] {
    return sampleSnapshotBuffer(this.snapshots, renderTimeMs - INTERPOLATION_DELAY_MS);
  }

  getView(): GameStateView | null {
    return this.view;
  }

  getLocalPlayerId(): number | null {
    return this.view?.localPlayerId ?? null;
  }

  /**
   * UX-only: true when the replicated Controller matches the local session.
   * The server still rejects MOVE that this check would miss.
   */
  canLocalPlayerControl(entityId: number): boolean {
    const localPlayerId = this.getLocalPlayerId();
    if (localPlayerId === null || !this.view) {
      return false;
    }
    const entity = this.view.entities.find((candidate) => candidate.entityId === entityId);
    return entity?.controllerPlayerId === localPlayerId;
  }

  /** First unit whose Controller matches the local session. */
  getLocalUnitEntityId(): number | null {
    const localPlayerId = this.getLocalPlayerId();
    if (localPlayerId === null || !this.view) {
      return null;
    }
    const unit = this.view.entities.find(
      (entity) => entity.kind === "unit" && entity.controllerPlayerId === localPlayerId,
    );
    return unit?.entityId ?? null;
  }

  /** Connected slots from the latest authoritative view. */
  getConnectedPlayerCount(): number {
    return this.view?.players.filter((player) => player.connected).length ?? 0;
  }

  /**
   * Entity a local MOVE may target.
   * Empty selection does not fall back to the bound unit — with more than one
   * controllable unit that fallback would move the wrong one.
   */
  getCommandEntityId(): number | null {
    return this.selectedIds[0] ?? null;
  }

  select(entityId: number | null): void {
    this.selectedIds = entityId === null ? [] : [entityId];
    this.emitState();
  }

  getSelectedIds(): readonly number[] {
    return this.selectedIds;
  }

  /**
   * Instant UX feedback only — does not move units or change authoritative state.
   */
  setDestinationMarker(point: { x: number; y: number } | null): void {
    this.destinationSim = point;
    this.emitState();
  }

  getDestinationMarker(): { x: number; y: number } | null {
    return this.destinationSim;
  }

  handleEvent(event: GameEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.sample(), this.view);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribeEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private emitState(): void {
    const poses = this.sample();
    for (const listener of this.stateListeners) {
      listener(poses, this.view);
    }
  }
}
