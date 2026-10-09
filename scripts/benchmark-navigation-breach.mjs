/** Reproducible diagnostic benchmark. Timing/instrumentation never ships in simulation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { SpatialGrid } from "../packages/simulation/dist/spatial-grid.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const revision = option("--revision", null);
const sourcePath = option("--source", "packages/simulation/src/navigation-breach.ts");
const label = option("--label", revision ?? "working-tree");
const samples = Number(option("--samples", "101"));
const warmups = Number(option("--warmup", "100"));
const output = option("--output", null);
let source = revision
  ? execFileSync("git", ["show", `${revision}:${sourcePath}`], { encoding: "utf8" })
  : await readFile(sourcePath, "utf8");
const referenceSource = source;

// Benchmark-only candidates; all modes run the same exact label search.
const representation = option("--representation", "arrays");
if (representation !== "arrays") {
  assert.ok(["bigint", "words"].includes(representation));
  const bigint = representation === "bigint";
  const setType = bigint ? "bigint" : "Uint32Array";
  source = source.replace(
    "readonly breached: readonly EntityId[];",
    `readonly breached: ${setType}; readonly breachCount: number;`,
  );
  source = source.replace(
    "breached: [],",
    `breached: ${bigint ? "0n" : "new Uint32Array()"}, breachCount: 0,`,
  );
  source = source.replace(
    "const classification =",
    "const ordinalByEntity = new Map<EntityId, number>();\n  const entities: EntityId[] = [];\n  const classification =",
  );
  source = source.replace("const open = new StateHeap();", "const open = new StateHeap(entities);");
  const start = source.indexOf("      const breached =");
  const end = source.indexOf("      const nextId =", start);
  assert.ok(start > 0 && end > start);
  source =
    source.slice(0, start) +
    `
      let breached = current.breached;
      let breachCount = current.breachCount;
      if (blocker !== null) {
        let ordinal = ordinalByEntity.get(blocker);
        if (ordinal === undefined) {
          ordinal = entities.length;
          entities.push(blocker);
          ordinalByEntity.set(blocker, ordinal);
        }
        ${
          bigint
            ? `const bit = 1n << BigInt(ordinal);
        if ((breached & bit) === 0n) { breached |= bit; breachCount++; }`
            : `const word = ordinal >>> 5;
        const bit = 1 << (ordinal & 31);
        if (((breached[word] ?? 0) & bit) === 0) {
          const next = new Uint32Array(Math.max(breached.length, word + 1));
          next.set(breached); next[word] |= bit; breached = next; breachCount++;
        }`
        }
      }
` +
    source.slice(end);
  source = source.replace("        breached,", "        breached, breachCount,");
  for (const state of ["current", "a", "b"])
    source = source.replaceAll(`${state}.breached.length`, `${state}.breachCount`);
  const subsetStart = source.indexOf("function isSubset(");
  const subsetEnd = source.indexOf("\nfunction cellFromId", subsetStart);
  source =
    source.slice(0, subsetStart) +
    (bigint
      ? "function isSubset(a: bigint, b: bigint): boolean { return (a & b) === a; }\n"
      : "function isSubset(a: Uint32Array, b: Uint32Array): boolean { for(let i=0;i<a.length;i++) if (((a[i]! & (b[i] ?? 0)) >>> 0) !== a[i]) return false; return true; }\n") +
    source.slice(subsetEnd);
  source = source.replace(
    "function comesBefore(a: SearchState, b: SearchState): boolean",
    "function comesBefore(a: SearchState, b: SearchState, entities: EntityId[]): boolean",
  );
  const tieStart = source.indexOf("  for (let index = 0; index < a.breachCount;");
  const tieEnd = source.indexOf("\n  return false;", tieStart);
  source =
    source.slice(0, tieStart) +
    `
  let lowestId = Infinity;
  let left = false;
  for (let i = 0; i < entities.length; i++) {
    const inA = ${bigint ? "(a.breached & (1n << BigInt(i))) !== 0n" : "((a.breached[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0"};
    const inB = ${bigint ? "(b.breached & (1n << BigInt(i))) !== 0n" : "((b.breached[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0"};
    if (inA !== inB && entities[i]! < lowestId) { lowestId = entities[i]!; left = inA; }
  }
  return left;` +
    source.slice(tieEnd);
  source = source.replace(
    "class StateHeap {",
    "class StateHeap { constructor(private readonly entities: EntityId[]) {} ",
  );
  source = source.replaceAll(
    "comesBefore(state, this.items[parent]!)",
    "comesBefore(state, this.items[parent]!, this.entities)",
  );
  source = source.replaceAll(
    "comesBefore(this.items[right]!, this.items[left]!)",
    "comesBefore(this.items[right]!, this.items[left]!, this.entities)",
  );
  source = source.replaceAll(
    "comesBefore(this.items[best]!, last)",
    "comesBefore(this.items[best]!, last, this.entities)",
  );
}

const reverseBfs = args.includes("--reverse-bfs");
if (reverseBfs) {
  const start = source.indexOf("  const heuristic =");
  const end = source.indexOf("  const startId =", start);
  assert.ok(start > 0 && end > start);
  source =
    source.slice(0, start) +
    `
  const distances = new Int32Array(grid.widthCells * grid.heightCells).fill(-1);
  const queue: CellCoord[] = [];
  const allowedByEntity = new Map<EntityId, boolean>();
  for (const goal of validGoals) { distances[grid.cellId(goal)] = 0; queue.push(goal); }
  for (let index = 0; index < queue.length; index++) {
    const cell = queue[index]!;
    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: cell.x + offset.x, y: cell.y + offset.y };
      if (!grid.isCellInBounds(next) || distances[grid.cellId(next)] !== -1 || !grid.isStaticWalkable(next)) continue;
      if (!grid.isWalkable(next)) {
        const occupant = grid.occupantAt(next);
        if (occupant === null || grid.footprintOf(occupant)?.blocksMovement !== true) continue;
        let allowed = allowedByEntity.get(occupant);
        if (allowed === undefined) { allowed = isHostileBreachable(occupant); allowedByEntity.set(occupant, allowed); }
        if (!allowed) continue;
      }
      distances[grid.cellId(next)] = distances[grid.cellId(cell)]! + 1;
      queue.push(next);
    }
  }
  if (distances[grid.cellId(start)] === -1) return { status: "no_route" };
  const heuristic = (cell: CellCoord): number => distances[grid.cellId(cell)]!;
` +
    source.slice(end);
  source = source.replace(
    "const classification = new Map<EntityId, boolean>();",
    "const classification = allowedByEntity;",
  );
}

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `instrumentation anchor: ${from}`);
  return text.replace(from, to);
}

function instrument(text) {
  text = `export const bench = { generated: 0, expanded: 0, peakHeap: 0, active: 0, peakActive: 0, pruned: 0, removed: 0, stale: 0, relaxedVisited: 0 };\n${text}`;
  if (reverseBfs)
    text = replaceOnce(
      text,
      "if (distances[grid.cellId(start)] === -1)",
      "bench.relaxedVisited = queue.length;\n  if (distances[grid.cellId(start)] === -1)",
    );
  text = replaceOnce(
    text,
    "push(state: SearchState): void {",
    `push(state: SearchState): void {
    bench.generated++;
    bench.peakHeap = Math.max(bench.peakHeap, this.items.length + 1);
    bench.peakActive = Math.max(bench.peakActive, bench.active);`,
  );
  text = replaceOnce(
    text,
    "if (goalIds.has(current.cellId)) {",
    "bench.expanded++;\n    if (goalIds.has(current.cellId)) {",
  );
  if (text.includes("bestStates")) {
    text = replaceOnce(text, "const bestStates =", "bench.active = 1;\n  const bestStates =");
    text = replaceOnce(
      text,
      "bestStates.set(key, state);",
      "if (known === undefined) bench.active++;\n      bestStates.set(key, state);",
    );
    text = replaceOnce(
      text,
      "if (bestStates.get(current.key) !== current) continue;",
      "if (bestStates.get(current.key) !== current) { bench.stale++; continue; }",
    );
  } else {
    text = replaceOnce(
      text,
      "labelsByCell[startId] = [initial];",
      "labelsByCell[startId] = [initial]; bench.active = 1;",
    );
    text = replaceOnce(
      text,
      "if (!current.active) continue;",
      "if (!current.active) { bench.stale++; continue; }",
    );
    text = replaceOnce(
      text,
      "if (dominated) continue;",
      "if (dominated) { bench.pruned++; continue; }",
    );
    text = replaceOnce(
      text,
      "label.active = false;",
      "label.active = false; bench.active--; bench.removed++;",
    );
    text = replaceOnce(text, "labels.push(state);", "labels.push(state); bench.active++;");
  }
  return text;
}

async function load(text) {
  const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const withImports = js.replace(
    /from "\.\/([^"\n]+)"/g,
    (_, file) => `from "${pathToFileURL(resolve("packages/simulation/dist", file)).href}"`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(withImports).toString("base64")}`);
}

const plain = await load(source);
const diagnostic = await load(instrument(source));
const reference = await load(referenceSource);

function grid(widthCells, heightCells, terrain = []) {
  return new SpatialGrid({
    id: "breach-benchmark",
    originX: 0,
    originY: 0,
    widthCells,
    heightCells,
    staticTerrain: terrain,
    playerSpawns: [],
    startingPlacements: [],
    resourcePlacements: [],
  });
}
function solid(target, id, x, y, width = 1, height = 1) {
  assert.deepEqual(
    target.addFootprint(id, {
      anchorCell: { x, y },
      width,
      height,
      blocksMovement: true,
      blocksBuilding: true,
    }),
    { ok: true },
  );
}
const terrain = (x, y, width = 1, height = 1) => ({
  x,
  y,
  width,
  height,
  walkable: false,
  buildable: false,
});
const fixtures = [];
function fixture(name, target, start, goals, allowed = () => true) {
  fixtures.push({ name, target, start, goals, allowed });
}
fixture("small-open", grid(16, 16), { x: 0, y: 0 }, [{ x: 15, y: 15 }]);
const wall = grid(16, 16);
solid(wall, 1, 8, 0, 1, 16);
fixture("one-wall", wall, { x: 0, y: 8 }, [{ x: 15, y: 8 }]);
const fortified = grid(32, 16);
for (let y = 0; y < 16; y++) solid(fortified, y + 1, 10, y);
solid(fortified, 99, 21, 0, 1, 16);
fixture("fortified-bottleneck", fortified, { x: 0, y: 8 }, [{ x: 31, y: 8 }]);
fixture(
  "fortified-multi-goal",
  fortified,
  { x: 0, y: 8 },
  Array.from({ length: 16 }, (_, y) => ({ x: 31, y })),
);
for (const count of [16, 32, 65]) {
  const target = grid(count * 2 + 1, 1);
  for (let index = 0; index < count; index++)
    solid(target, 4000000000 - index * 17, index * 2 + 1, 0);
  fixture(`serial-${count}-blockers`, target, { x: 0, y: 0 }, [{ x: count * 2, y: 0 }]);
}
const corridorTerrain = [];
for (const x of [8, 16])
  for (let y = 0; y < 9; y++) if (y % 2 === 1) corridorTerrain.push(terrain(x, y));
const equivalent = grid(25, 9, corridorTerrain);
for (const x of [8, 16]) for (let y = 0; y < 9; y += 2) solid(equivalent, x * 10 + y, x, y);
fixture("equivalent-corridors", equivalent, { x: 0, y: 4 }, [{ x: 24, y: 4 }]);
fixture("static-barrier", grid(40, 24, [terrain(20, 0, 1, 24)]), { x: 0, y: 12 }, [
  { x: 39, y: 12 },
]);
const impossible = grid(24, 5, [terrain(20, 0, 1, 5)]);
for (let index = 0; index < 8; index++) solid(impossible, index + 1, 2 + index * 2, 2);
fixture("combinatorial-no-route", impossible, { x: 0, y: 2 }, [{ x: 23, y: 2 }]);
const gateTerrain = [];
for (let index = 0; index < 5; index++) gateTerrain.push(terrain(2 + index * 3, 1));
const gates = grid(17, 3, gateTerrain);
for (let index = 0; index < 5; index++) {
  solid(gates, index * 2 + 1, 2 + index * 3, 0);
  solid(gates, index * 2 + 2, 2 + index * 3, 2);
}
fixture("combinatorial-five-gates", gates, { x: 0, y: 1 }, [{ x: 16, y: 1 }]);
const mazeTerrain = [];
for (let index = 0; index < 8; index++)
  mazeTerrain.push(terrain(3 + index * 4, index % 2 === 0 ? 0 : 1, 1, 23));
fixture("static-maze", grid(36, 24, mazeTerrain), { x: 0, y: 0 }, [{ x: 35, y: 0 }]);

const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const results = [];
for (const entry of fixtures) {
  const query = (fn) => fn(entry.target, entry.start, entry.goals, entry.allowed);
  const expected = query(plain.findBreachPath);
  const referenceResult = query(reference.findBreachPath);
  if (!reverseBfs) assert.deepEqual(expected, referenceResult);
  else
    assert.deepEqual(
      [expected.status, expected.breachCount, expected.pathLength],
      [referenceResult.status, referenceResult.breachCount, referenceResult.pathLength],
    );
  assert.deepEqual(query(diagnostic.findBreachPath), expected);
  const counters = { ...diagnostic.bench };
  for (const key of Object.keys(diagnostic.bench)) diagnostic.bench[key] = 0;
  for (let warmup = 0; warmup < warmups; warmup++) query(plain.findBreachPath);
  globalThis.gc?.();
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    const before = performance.now();
    const actual = query(plain.findBreachPath);
    times.push(performance.now() - before);
    assert.deepEqual(actual, expected);
  }
  const allocations = [];
  const arrayBuffers = [];
  for (let sample = 0; sample < 3; sample++) {
    globalThis.gc?.();
    const before = process.memoryUsage();
    query(plain.findBreachPath);
    const after = process.memoryUsage();
    allocations.push(after.heapUsed - before.heapUsed);
    arrayBuffers.push(after.arrayBuffers - before.arrayBuffers);
  }
  const result = {
    name: entry.name,
    cells: entry.target.widthCells * entry.target.heightCells,
    status: expected.status,
    breachCount: expected.breachCount ?? null,
    pathLength: expected.pathLength ?? null,
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    heapDeltaBytes: percentile(allocations, 0.5),
    arrayBufferDeltaBytes: percentile(arrayBuffers, 0.5),
    ...counters,
  };
  results.push(result);
  console.log(JSON.stringify({ label, ...result }));
}
const report = {
  label,
  revision,
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  representation,
  reverseBfs,
  node: process.version,
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  samples,
  warmup: warmups,
  gcAvailable: typeof globalThis.gc === "function",
  results,
};
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
