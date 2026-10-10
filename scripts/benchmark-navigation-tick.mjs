/** Isolated diagnostic harness: no changes to production map selection or AI gameplay. */
import { performance } from "node:perf_hooks";
import { cpus, platform, arch, release, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { FOUNDATION_MAP } from "../packages/game-data/dist/index.js";
import { createWorld } from "../packages/simulation/dist/world.js";
import { createMatchRuntime } from "../packages/simulation/dist/match-runtime.js";
import {
  scheduleCommands,
  commandPathCost,
} from "../packages/simulation/dist/command-scheduler.js";
import { EntityPathQueryLane } from "../packages/simulation/dist/path-query-lane.js";
import { planMove, planMoveToTarget } from "../packages/simulation/dist/navigation.js";
const warmups = 5,
  samples = 30;
const solid = (x, y, width = 1, height = 1) => ({
  anchorCell: { x, y },
  width,
  height,
  blocksMovement: true,
  blocksBuilding: true,
});
const command = (ids, target, id = "bench") => ({
  type: "MOVE",
  entityIds: ids,
  target,
  commandId: id,
});
function unit(world, point, player = 0) {
  const id = world.createEntity({ kind: "UNIT", definitionId: "foundation_unit" });
  world.positions.set(id, { ...point });
  world.controllers.set(id, { controllerPlayerId: player });
  return id;
}
function production() {
  const runtime = createMatchRuntime({
    seed: 87,
    mapId: "benchmark-256-is-ignored",
    participants: [0, 1, 2, 3].map((playerId) => ({ playerId })),
  });
  const units = runtime.readSnapshot().entities.filter((e) => e.kind === "UNIT");
  for (const e of units)
    for (let i = 0; i < 4; i++)
      runtime.submitCommand(
        { playerId: e.controllerPlayerId },
        command([e.entityId], { x: 0, y: 0 }, `${e.entityId}-${i}`),
      );
  return () => {
    runtime.step();
    const m = runtime.readMetrics();
    if (m.reservedCommandPathCost !== 16) throw Error("production budget");
    return m;
  };
}
function synthetic(size, distinct, churn, singleCommands = false) {
  const world = createWorld({
    seed: 87,
    map: {
      ...FOUNDATION_MAP,
      id: `synthetic-${size}`,
      originX: -size / 2,
      originY: -size / 2,
      widthCells: size,
      heightCells: size,
      staticTerrain: [],
      startingPlacements: [],
      resourcePlacements: [],
      playerSpawns: [],
    },
  });
  const grid = world.grid;
  grid.addFootprint(10001, solid(size / 2 - 1, size / 2 - 1, 2, 2));
  if (distinct) grid.addFootprint(10002, solid(size / 2 + 2, 0, 1, size));
  const origins = Array.from({ length: 16 }, (_, i) => ({
    x: distinct && i % 2 ? size / 2 - 3.5 : -size / 2 + 2.5 + (i % 4) * 0.1,
    y: -size / 2 + 2.5 + Math.floor(i / 4) * 0.1,
  }));
  const ids = origins.map((p) => unit(world, p));
  // Eight accepted tasks share an unsafe segment; actual World movement reserves replans.
  for (let i = 0; i < 8; i++) {
    const p = { x: -size / 2 + 4.5 + i * 0.01, y: -size / 2 + 4.5 };
    const id = unit(world, p, 1),
      target = { x: distinct ? 0.5 : size / 2 - 4.5, y: p.y };
    const task = planMove(grid, p, target);
    if (!task) throw Error("active setup");
    world.navigations.set(id, task);
    world.movements.set(id, { targetX: target.x, targetY: target.y, speed: 1 });
  }
  grid.addFootprint(10003, solid(size / 2 - 2, 4));
  const queues = new Map([
    [
      0,
      singleCommands
        ? ids.map((id, i) => command([id], { x: 0, y: 0 }, `single-${i}`))
        : [command(ids, { x: 0, y: 0 })],
    ],
  ]);
  world.drainEvents();
  const aiOrigins = origins.slice(0, 8);
  return () => {
    // Cost of successful add/remove included for churn, including invalidation/rebuild on the next query.
    if (churn) {
      grid.addFootprint(10004, solid(size - 2, size - 2));
      grid.removeFootprint(10004);
    }
    const selected = scheduleCommands(
      queues,
      undefined,
      16,
      world.config.pathQueriesPerTick.commandBudget,
      commandPathCost,
    );
    for (const { playerId, command: c } of selected.selected)
      world.enqueueCommand({ actor: { playerId }, command: c });
    world.step();
    const events = world.drainEvents();
    if (events.some((e) => e.type === "COMMAND_REJECTED")) throw Error("synthetic MOVE rejected");
    const ai = new EntityPathQueryLane(world.config.pathQueriesPerTick.aiBudget);
    for (let i = 0; i < 12; i++)
      if (ai.tryReserve(20000 + i)) {
        if (!planMoveToTarget(grid, aiOrigins[i % 8], { x: 0, y: 0 }))
          throw Error("synthetic AI query");
      }
    const metrics = {
      ...world.readPathQueryMetrics(),
      aiQueries: ai.used,
      reservedCommandPathCost: selected.reservedCost,
      processedCommands: selected.selected.length,
    };
    if (metrics.activeTaskQueries !== 8 || metrics.aiQueries !== 8 || selected.reservedCost !== 16)
      throw Error(JSON.stringify(metrics));
    return metrics;
  };
}
function measure(name, factory) {
  for (let i = 0; i < warmups; i++) factory()();
  const times = [];
  for (let i = 0; i < samples; i++) {
    const run = factory();
    const t = performance.now();
    run();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  // Separate memory observation: end-of-call heap delta is NOT total allocated bytes or peak heap.
  const run = factory();
  global.gc?.();
  const before = process.memoryUsage();
  const metrics = run();
  const transient = process.memoryUsage();
  global.gc?.();
  const retained = process.memoryUsage();
  const ms = (p) => +times[Math.ceil(p * samples) - 1].toFixed(3);
  return {
    name,
    minMs: +times[0].toFixed(3),
    p50Ms: ms(0.5),
    p95Ms: ms(0.95),
    maxMs: +times.at(-1).toFixed(3),
    metrics,
    memory: {
      heapDeltaBeforeGC: transient.heapUsed - before.heapUsed,
      heapDeltaAfterGC: retained.heapUsed - before.heapUsed,
      arrayBufferDelta: retained.arrayBuffers - before.arrayBuffers,
    },
  };
}
const rows = [measure("production-Foundation-40-full-MatchRuntime-step", production)];
for (const size of [40, 80, 128, 256])
  for (const distinct of [false, true])
    for (const churn of [false, true])
      rows.push(
        measure(
          `synthetic-${size}-${distinct ? "distinct-components" : "connected"}-${churn ? "topology-churn" : "cold"}-saturated-lanes`,
          () => synthetic(size, distinct, churn),
        ),
      );
rows.push(
  measure("synthetic-256-connected-16-single-commands-saturated-lanes", () =>
    synthetic(256, false, false, true),
  ),
);
const report = {
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  },
  warmups,
  samples,
  percentile: "nearest-rank",
  gcExposed: !!global.gc,
  rows,
};
writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
