/** Repeated requests on one grid: timing outside simulation, counters in separate runs. */
import { Session } from "node:inspector/promises";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { FOUNDATION_MAP } from "../packages/game-data/dist/index.js";
import { SpatialGrid } from "../packages/simulation/dist/spatial-grid.js";
import { readComponentCache } from "../packages/simulation/dist/navigation-components.js";
import * as navigation from "../packages/simulation/dist/navigation.js";
const warmups = 5,
  samples = 30;
const solid = (x, y, width = 1, height = 1) => ({
  anchorCell: { x, y },
  width,
  height,
  blocksMovement: true,
  blocksBuilding: true,
});
const work = () => ({
  astarExpandedCells: 0,
  blockedTargetVisitedCells: 0,
  componentReuseHits: 0,
  componentCandidateEvaluations: 0,
});
function setup(distinct) {
  const size = 256;
  const grid = new SpatialGrid({
    ...FOUNDATION_MAP,
    id: "lifecycle",
    widthCells: size,
    heightCells: size,
    originX: -128,
    originY: -128,
    staticTerrain: [],
    startingPlacements: [],
    playerSpawns: [],
  });
  grid.addFootprint(1, solid(127, 127, 2, 2));
  if (distinct) grid.addFootprint(2, solid(130, 0, 1, 256));
  return grid;
}
function group(grid, n, distinct, w) {
  const scope = navigation.MoveTargetResolution
    ? new navigation.MoveTargetResolution(grid, { x: 0, y: 0 })
    : undefined;
  return Array.from({ length: n }, (_, i) =>
    navigation.planMoveToTarget(
      grid,
      {
        x: distinct && i % 2 ? 124.5 : -125.5 + (i % 4) * 0.1,
        y: -125.5 + Math.floor(i / 4) * 0.1,
      },
      { x: 0, y: 0 },
      w,
      scope,
    ),
  );
}
const rows = [];
for (const distinct of [false, true])
  for (const n of [1, 16])
    for (const mode of ["cold", "warm", "rebuild", "repeat-10"]) {
      let grid = setup(distinct);
      const run = (w) => {
        if (mode === "rebuild") {
          grid.addFootprint(3, solid(254, 254));
          grid.removeFootprint(3);
        }
        for (let i = 0; i < (mode === "repeat-10" ? 10 : 1); i++) group(grid, n, distinct, w);
      };
      for (let i = 0; i < warmups; i++) {
        if (mode === "cold") grid = setup(distinct);
        run();
      }
      const times = [];
      for (let i = 0; i < samples; i++) {
        if (mode === "cold") grid = setup(distinct);
        const t = performance.now();
        run();
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      if (mode === "cold") grid = setup(distinct);
      const counters = work();
      run(counters);
      if (mode === "cold") grid = setup(distinct);
      global.gc?.();
      const before = process.memoryUsage();
      run();
      const transient = process.memoryUsage();
      global.gc?.();
      const retained = process.memoryUsage();
      if (mode === "cold") grid = setup(distinct);
      const session = new Session();
      session.connect();
      await session.post("HeapProfiler.startSampling", {
        samplingInterval: 32768,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      run();
      const { profile } = await session.post("HeapProfiler.stopSampling");
      session.disconnect();
      const sampledBytes = (node) =>
        node.selfSize + node.children.reduce((sum, child) => sum + sampledBytes(child), 0);
      rows.push({
        distinct,
        groupSize: n,
        mode,
        minMs: times[0],
        p50Ms: times[14],
        p95Ms: times[28],
        maxMs: times[29],
        counters,
        retainedResolutionCacheBytes: readComponentCache(grid)?.retainedArrayBytes ?? 0,
        cache: readComponentCache(grid),
        memory: {
          sampledAllocatedBytes: sampledBytes(profile.head),
          heapDeltaBeforeGC: transient.heapUsed - before.heapUsed,
          heapDeltaAfterGC: retained.heapUsed - before.heapUsed,
          arrayBufferDelta: retained.arrayBuffers - before.arrayBuffers,
        },
      });
    }
writeFileSync(
  process.argv[2],
  JSON.stringify(
    {
      warmups,
      samples,
      rows,
      notes:
        "Cold uses a fresh grid per sample; warm/rebuild/repeat use a single grid. Baseline and group-scoped A have no cross-command cache: cold/warm both resolve again. Rebuild is successful topology add/remove plus next resolution. Memory deltas observe end of call, not allocation volume or peak.",
    },
    null,
    2,
  ) + "\n",
);
