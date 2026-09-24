import type { ComponentStore } from "../component-store.js";
import type { Movement, Position } from "../types.js";

const ARRIVAL_EPSILON = 1e-6;

/**
 * Advances entities with Position + Movement toward their targets.
 * Displacement uses fixed tick duration from config, never wall-clock time.
 */
export function runMovementSystem(
  positions: ComponentStore<Position>,
  movements: ComponentStore<Movement>,
  tickDurationSeconds: number,
): void {
  for (const [entityId, movement] of movements.entries()) {
    const position = positions.get(entityId);
    if (position === undefined) {
      movements.remove(entityId);
      continue;
    }

    const dx = movement.targetX - position.x;
    const dy = movement.targetY - position.y;
    const distance = Math.hypot(dx, dy);
    const step = movement.speed * tickDurationSeconds;

    if (distance <= step || distance <= ARRIVAL_EPSILON) {
      positions.set(entityId, { x: movement.targetX, y: movement.targetY });
      movements.remove(entityId);
      continue;
    }

    const ratio = step / distance;
    positions.set(entityId, {
      x: position.x + dx * ratio,
      y: position.y + dy * ratio,
    });
  }
}
