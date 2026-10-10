/** Diagnostic, not a timing CI gate. Run after pnpm build. */
import { performance } from "node:perf_hooks";
import { cpus, platform, arch } from "node:os";
import { writeFileSync } from "node:fs";
import { readComponentCache } from "../packages/simulation/dist/navigation-components.js";
import { SpatialGrid } from "../packages/simulation/dist/spatial-grid.js";
import { planMoveToTarget, MoveTargetResolution } from "../packages/simulation/dist/navigation.js";
import { FOUNDATION_MAP, getEntityDefinition } from "../packages/game-data/dist/index.js";

const warmups = 5;
const samples = 30;
const rows = [];
for (const size of [40, 80, 128, 256]) {
  for (const layout of ["connected", "partitioned"]) {
    const map =
      size === 40
        ? FOUNDATION_MAP
        : {
            ...FOUNDATION_MAP,
            id: `benchmark-${size}`,
            originX: -size / 2,
            originY: -size / 2,
            widthCells: size,
            heightCells: size,
            staticTerrain: [],
            startingPlacements: [],
            playerSpawns: [],
          };
    const grid = new SpatialGrid(map);
    if (size === 40) {
      const placement = FOUNDATION_MAP.startingPlacements[0];
      const definition = getEntityDefinition(placement.definitionId);
      grid.addFootprint(1, { anchorCell: placement.anchorCell, ...definition.footprint });
    } else {
      grid.addFootprint(1, {
        anchorCell: { x: size / 2 - 1, y: size / 2 - 1 },
        width: 2,
        height: 2,
        blocksMovement: true,
        blocksBuilding: true,
      });
    }
    // A full-height wall partitions the source component to roughly half the map.
    if (layout === "partitioned")
      grid.addFootprint(2, {
        anchorCell: { x: size / 2 + 2, y: 0 },
        width: 1,
        height: size,
        blocksMovement: true,
        blocksBuilding: true,
      });
    for (const targetKind of ["reachable", "blocked"]) {
      const target = targetKind === "blocked" ? { x: 0, y: 0 } : { x: -1.5, y: -1.5 };
      for (const groupSize of [1, 8, 16]) {
        const origins = Array.from({ length: groupSize }, (_, i) =>
          size === 40
            ? { x: -6 + (i % 4) * 0.1, y: -3 + Math.floor(i / 4) * 0.1 }
            : { x: -size / 2 + 2.5 + (i % 4) * 0.1, y: -size / 2 + 2.5 + Math.floor(i / 4) * 0.1 },
        );
        const run = (work, queryGrid = grid) => {
          const resolution = new MoveTargetResolution(queryGrid, target);
          const destinations = origins.map((origin) => {
            const task = planMoveToTarget(queryGrid, origin, target, work, resolution);
            if (!task) throw new Error("expected reachable query");
            return [task.destinationX, task.destinationY];
          });
          return destinations;
        };
        for (let i = 0; i < warmups; i++) run();
        const timings = [];
        for (let i = 0; i < samples; i++) {
          const start = performance.now();
          run();
          timings.push(performance.now() - start);
        }
        timings.sort((a, b) => a - b);
        const freshGrid = () => {
          const fresh = new SpatialGrid(map);
          for (const id of [1, 2]) {
            const footprint = grid.footprintOf(id);
            if (footprint) fresh.addFootprint(id, footprint);
          }
          return fresh;
        };
        const coldTimings = [];
        for (let i = 0; i < warmups + samples; i++) {
          const fresh = freshGrid();
          const t = performance.now();
          run(undefined, fresh);
          if (i >= warmups) coldTimings.push(performance.now() - t);
        }
        coldTimings.sort((a, b) => a - b);
        const coldWork = { astarExpandedCells: 0, blockedTargetVisitedCells: 0 };
        run(coldWork, freshGrid());
        const work = {
          astarExpandedCells: 0,
          blockedTargetVisitedCells: 0,
          componentReuseHits: 0,
          componentCandidateEvaluations: 0,
        };
        const expected = JSON.stringify(run(work));
        if (JSON.stringify(run()) !== expected) throw new Error("non-repeatable destination");
        const percentile = (p) => +timings[Math.ceil(p * samples) - 1].toFixed(3);
        rows.push({
          size,
          layout,
          targetKind,
          groupSize,
          minMs: +timings[0].toFixed(3),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          maxMs: +timings.at(-1).toFixed(3),
          ...work,
          cache: readComponentCache(grid),
          cold: {
            minMs: +coldTimings[0].toFixed(3),
            p50Ms: +coldTimings[14].toFixed(3),
            p95Ms: +coldTimings[28].toFixed(3),
            maxMs: +coldTimings.at(-1).toFixed(3),
            ...coldWork,
          },
        });
      }
    }
  }
}
const report = {
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  warmups,
  samples,
  rows,
};
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
else console.log(JSON.stringify(report, null, 2));
