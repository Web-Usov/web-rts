/** Diagnostic lazy vs eager labelling, outside gameplay. Run after pnpm build. */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { FOUNDATION_MAP } from "../../../packages/game-data/dist/index.js";
import { SpatialGrid } from "../../../packages/simulation/dist/spatial-grid.js";
import {
  reachableComponent,
  readComponentCache,
} from "../../../packages/simulation/dist/navigation-components.js";
const warmups = 5,
  samples = 30,
  rows = [];
for (const size of [40, 80, 128, 256])
  for (const partitioned of [false, true])
    for (const strategy of ["lazy", "full"]) {
      const make = () =>
        new SpatialGrid({
          ...FOUNDATION_MAP,
          widthCells: size,
          heightCells: size,
          originX: 0,
          originY: 0,
          staticTerrain: partitioned
            ? [{ x: size / 2, y: 0, width: 1, height: size, walkable: false, buildable: false }]
            : [],
          startingPlacements: [],
          playerSpawns: [],
        });
      const run = (grid, work) => {
        if (strategy === "lazy") reachableComponent(grid, { x: 0, y: 0 }, work);
        else {
          // Experimental eager driver needs a transient seen byte/cell; not production storage.
          const seen = new Uint8Array(size * size);
          for (let id = 0; id < seen.length; id++) {
            const cell = { x: id % size, y: Math.floor(id / size) };
            if (seen[id] || !grid.isWalkable(cell)) continue;
            for (const member of reachableComponent(grid, cell, work).cells) seen[member] = 1;
          }
        }
      };
      const times = [];
      for (let i = 0; i < warmups + samples; i++) {
        const grid = make(),
          t = performance.now();
        run(grid);
        if (i >= warmups) times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      const grid = make(),
        work = {};
      run(grid, work);
      rows.push({
        size,
        partitioned,
        strategy,
        minMs: times[0],
        p50Ms: times[14],
        p95Ms: times[28],
        maxMs: times[29],
        work,
        cache: readComponentCache(grid),
        extraTransientSeenBytes: strategy === "full" ? size * size : 0,
      });
    }
writeFileSync(process.argv[2], JSON.stringify({ warmups, samples, rows }, null, 2) + "\n");
