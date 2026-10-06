import type { PresentationKind } from "./types.js";

/**
 * Player color slot follows stable Owner, never transient Controller
 * (Spec #002 §16, §24; Art Direction player-color). Unowned entities use slot 0.
 */
export function ownerColorSlot(kind: PresentationKind, ownerPlayerId: number | null): number {
  if (kind === "OBJECTIVE" || ownerPlayerId === null) {
    return 0;
  }
  return ownerPlayerId;
}
