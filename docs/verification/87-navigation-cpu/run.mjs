/** Reproduce final measurements sequentially. Supply a fresh output directory. */
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (!process.argv[2])
  throw Error("Usage: node docs/verification/87-navigation-cpu/run.mjs <fresh-output-directory>");
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
for (const [script, name, gc] of [
  ["scripts/benchmark-navigation.mjs", "matrix", false],
  ["scripts/benchmark-navigation-tick.mjs", "tick", true],
  ["scripts/benchmark-navigation-lifecycle.mjs", "lifecycle", true],
  ["docs/verification/87-navigation-cpu/label-strategies.mjs", "label-strategies", false],
])
  execFileSync(
    process.execPath,
    [...(gc ? ["--expose-gc"] : []), script, resolve(output, `${name}.json`)],
    { cwd: root, stdio: "inherit" },
  );
