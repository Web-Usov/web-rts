import type { GameEvent, GameStateView } from "@web-rts/protocol";
import {
  interpolateSnapshots,
  interpolationAlpha,
  type InterpolatedPose,
  type StateSnapshot,
} from "./interpolation.js";

type StateListener = (poses: readonly InterpolatedPose[], view: GameStateView | null) => void;
type EventListener = (event: GameEvent) => void;

/**
 * Holds authoritative replicated snapshots and exposes interpolated poses for presentation.
 * Destination marker UX is intentionally separate and never mutates entity authority.
 */
export class ClientGameState {
  private previous: StateSnapshot | null = null;
  private latest: StateSnapshot | null = null;
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

    if (this.latest === null) {
      this.previous = snapshot;
      this.latest = snapshot;
    } else {
      this.previous = this.latest;
      this.latest = snapshot;
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

  sample(renderTimeMs: number = this.renderTimeMs): readonly InterpolatedPose[] {
    if (!this.previous || !this.latest) {
      return [];
    }
    const alpha = interpolationAlpha(this.previous, this.latest, renderTimeMs);
    return interpolateSnapshots(this.previous, this.latest, alpha);
  }

  getView(): GameStateView | null {
    return this.view;
  }

  getLocalPlayerId(): number | null {
    return this.view?.localPlayerId ?? null;
  }

  /** Entity bound to the local session via F5 controllerPlayerId annotation. */
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
