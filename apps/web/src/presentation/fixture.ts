import type { PresentationSyncData } from "./types.js";

/** Developer-art snapshot so the shell is visible before replication exists. */
export const developerPresentationFixture: PresentationSyncData = {
  entities: [
    {
      id: 1,
      kind: "unit",
      position: { x: -6, y: 0.6, z: -3 },
      colorSlot: 0,
    },
    {
      id: 2,
      kind: "unit",
      position: { x: 6, y: 0.6, z: -3 },
      colorSlot: 1,
    },
    {
      id: 3,
      kind: "objective",
      position: { x: 0, y: 1.2, z: 6 },
      colorSlot: 2,
    },
  ],
  selectedIds: [],
  destination: null,
};
