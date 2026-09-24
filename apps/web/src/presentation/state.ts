import type {
  GroundPoint,
  HudView,
  PresentationDiff,
  PresentationEntity,
  PresentationSyncData,
} from "./types.js";

type HudListener = (view: HudView) => void;

/**
 * Presentation model owned outside React.
 * Positions live here and on Babylon meshes, never in component state.
 */
export class PresentationState {
  private readonly entities = new Map<number, PresentationEntity>();
  private selectedIds: number[] = [];
  private destination: GroundPoint | null = null;
  private readonly listeners = new Set<HudListener>();

  apply(data: PresentationSyncData): PresentationDiff {
    const nextIds = new Set(data.entities.map((entity) => entity.id));
    const removedIds: number[] = [];

    for (const id of this.entities.keys()) {
      if (!nextIds.has(id)) {
        this.entities.delete(id);
        removedIds.push(id);
      }
    }

    const upserted: PresentationEntity[] = [];
    for (const entity of data.entities) {
      const previous = this.entities.get(entity.id);
      if (!sameEntity(previous, entity)) {
        this.entities.set(entity.id, entity);
        upserted.push(entity);
      }
    }

    this.selectedIds = data.selectedIds.filter((id) => this.entities.has(id));
    this.destination = data.destination;
    this.emit();

    return { upserted, removedIds };
  }

  select(id: number | null): void {
    this.selectedIds = id !== null && this.entities.has(id) ? [id] : [];
    this.emit();
  }

  setDestination(point: GroundPoint | null): void {
    this.destination = point;
    this.emit();
  }

  getEntity(id: number): PresentationEntity | undefined {
    return this.entities.get(id);
  }

  getEntities(): readonly PresentationEntity[] {
    return [...this.entities.values()];
  }

  getSelectedIds(): readonly number[] {
    return this.selectedIds;
  }

  getDestination(): GroundPoint | null {
    return this.destination;
  }

  isSelected(id: number): boolean {
    return this.selectedIds.includes(id);
  }

  getHudView(): HudView {
    return {
      entityCount: this.entities.size,
      selectedIds: this.selectedIds,
      hasDestination: this.destination !== null,
    };
  }

  subscribe(listener: HudListener): () => void {
    this.listeners.add(listener);
    listener(this.getHudView());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const view = this.getHudView();
    for (const listener of this.listeners) {
      listener(view);
    }
  }
}

function sameEntity(previous: PresentationEntity | undefined, next: PresentationEntity): boolean {
  if (!previous) {
    return false;
  }

  return (
    previous.kind === next.kind &&
    previous.colorSlot === next.colorSlot &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y &&
    previous.position.z === next.position.z
  );
}
