/** Adversarial topology churn: blocked command + 8 failed active replans + 8 failed synthetic AI queries. */
import { performance } from "node:perf_hooks";
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { FOUNDATION_MAP } from "../../../packages/game-data/dist/index.js";
import {
  scheduleCommands,
  commandPathCost,
} from "../../../packages/simulation/dist/command-scheduler.js";
import { EntityPathQueryLane } from "../../../packages/simulation/dist/path-query-lane.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temporary = mkdtempSync(resolve(tmpdir(), "web-rts-87-reference-"));
const baseline = "9507da838f6519c1ce3b0f05e3ddbf20170a8bfc";
cpSync(resolve(root, "packages/simulation/dist"), temporary, { recursive: true });
symlinkSync(
  resolve(root, "packages/simulation/node_modules"),
  resolve(temporary, "node_modules"),
  "dir",
);
for (const name of ["navigation", "world"]) {
  const source = execFileSync("git", ["show", `${baseline}:packages/simulation/src/${name}.ts`], {
    cwd: root,
    encoding: "utf8",
  });
  writeFileSync(
    resolve(temporary, `${name}.js`),
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
}
writeFileSync(resolve(temporary, "package.json"), ' {"type":"module"} ');
const solid = (x, y, width = 1, height = 1) => ({
  anchorCell: { x, y },
  width,
  height,
  blocksMovement: true,
  blocksBuilding: true,
});
const rows = [];
try {
  for (const implementation of ["baseline", "final"]) {
    const directory =
      implementation === "baseline" ? temporary : resolve(root, "packages/simulation/dist");
    const { createWorld } = await import(pathToFileURL(resolve(directory, "world.js")).href);
    const nav = await import(pathToFileURL(resolve(directory, "navigation.js")).href);
    function setup() {
      const world = createWorld({
          seed: 87,
          map: {
            ...FOUNDATION_MAP,
            id: "adversarial-churn",
            originX: -128,
            originY: -128,
            widthCells: 256,
            heightCells: 256,
            staticTerrain: [],
            startingPlacements: [],
            resourcePlacements: [],
            playerSpawns: [],
          },
        }),
        grid = world.grid;
      grid.addFootprint(10001, solid(127, 127, 2, 2));
      const origin = { x: -125.5, y: -125.5 },
        destination = { x: 124.5, y: -125.5 };
      function unit() {
        const id = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
        world.positions.set(id, { ...origin });
        world.controllers.set(id, { controllerPlayerId: 0 });
        return id;
      }
      const ids = Array.from({ length: 16 }, unit);
      for (let i = 0; i < 8; i++) {
        const id = unit(),
          task = nav.planMove(grid, origin, destination);
        world.navigations.set(id, task);
        world.movements.set(id, { targetX: destination.x, targetY: destination.y, speed: 1 });
      }
      // Prime old revision outside timing, so final implementation must genuinely rebuild after churn.
      nav.planMoveToTarget(grid, origin, { x: 0, y: 0 });
      const queues = new Map([
        [0, [{ type: "MOVE", commandId: "adversarial", entityIds: ids, target: { x: 0, y: 0 } }]],
      ]);
      world.drainEvents();
      return () => {
        grid.addFootprint(10002, solid(130, 0, 1, 256));
        const selection = scheduleCommands(queues, undefined, 16, 16, commandPathCost);
        for (const { playerId, command } of selection.selected)
          world.enqueueCommand({ actor: { playerId }, command });
        world.step();
        world.drainEvents();
        const lane = new EntityPathQueryLane(8);
        for (let i = 0; i < 12; i++)
          if (lane.tryReserve(20000 + i) && nav.planMove(grid, origin, destination) !== null)
            throw Error("AI expected no_path");
        return {
          ...world.readPathQueryMetrics(),
          aiQueries: lane.used,
          reservedCommandPathCost: selection.reservedCost,
        };
      };
    }
    const times = [];
    for (let i = 0; i < 35; i++) {
      const run = setup(),
        t = performance.now();
      run();
      if (i >= 5) times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const metrics = setup()();
    rows.push({
      implementation,
      sourceRevision:
        implementation === "baseline"
          ? baseline
          : execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      minMs: times[0],
      p50Ms: times[14],
      p95Ms: times[28],
      maxMs: times[29],
      metrics,
    });
  }
  writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        warmups: 5,
        samples: 30,
        rows,
        notes:
          "Reference navigation/world compiled from baseline Git source in temporary directory; remaining dependencies unchanged. Prime excluded; solid wall insertion and cache rebuild included. Synthetic AI is not production G9.",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
