/**
 * Snapshot interpolation between authoritative entity positions.
 * Independent of Babylon; caller passes explicit render/interpolation time.
 */

export type EntitySnapshotPose = {
  readonly entityId: number;
  readonly x: number;
  readonly y: number;
  readonly kind: "unit" | "objective";
  readonly ownerPlayerId: number | null;
  readonly controllerPlayerId: number | null;
};

export type StateSnapshot = {
  readonly tick: number;
  /** Monotonic render clock sample when the snapshot was accepted (ms). */
  readonly timeMs: number;
  readonly entities: readonly EntitySnapshotPose[];
};

export type InterpolatedPose = {
  readonly entityId: number;
  readonly x: number;
  readonly y: number;
  readonly kind: "unit" | "objective";
  readonly ownerPlayerId: number | null;
  readonly controllerPlayerId: number | null;
};

/**
 * Linearly interpolates entity positions between two authoritative snapshots.
 * `alpha` is in [0, 1]; values outside are clamped.
 * Entities only in one snapshot snap to that snapshot's pose.
 */
export function interpolateSnapshots(
  from: StateSnapshot,
  to: StateSnapshot,
  alpha: number,
): InterpolatedPose[] {
  const t = clamp01(alpha);
  const fromById = new Map(from.entities.map((e) => [e.entityId, e]));
  const toById = new Map(to.entities.map((e) => [e.entityId, e]));
  const ids = new Set([...fromById.keys(), ...toById.keys()]);
  const result: InterpolatedPose[] = [];

  for (const entityId of ids) {
    const a = fromById.get(entityId);
    const b = toById.get(entityId);
    if (a && b) {
      result.push({
        entityId,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        kind: b.kind,
        ownerPlayerId: b.ownerPlayerId,
        controllerPlayerId: b.controllerPlayerId,
      });
      continue;
    }
    const only = b ?? a;
    if (only) {
      result.push({ ...only });
    }
  }

  return result.sort((left, right) => left.entityId - right.entityId);
}

/**
 * Computes alpha from render time relative to the two snapshot timestamps.
 * When `renderTimeMs` is at/after `to.timeMs`, alpha = 1 (hold latest).
 */
export function interpolationAlpha(
  from: StateSnapshot,
  to: StateSnapshot,
  renderTimeMs: number,
): number {
  const span = to.timeMs - from.timeMs;
  if (span <= 0) {
    return 1;
  }
  return clamp01((renderTimeMs - from.timeMs) / span);
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}
