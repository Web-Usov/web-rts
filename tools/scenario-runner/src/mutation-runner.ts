import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  classifyDetector,
  evaluateMatrix,
  replaceAnchor,
  type DetectorReport,
  type Mutation,
  type MutationStatus,
} from "./mutation-catalog.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
// Includes untracked files and their contents, not only git diff. Ignored artifacts are excluded.
export function sourceFingerprint(root: string): string {
  const files = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean)
    .sort();
  return hash(
    files
      .map(
        (f) =>
          `${f}\0${existsSync(join(root, f)) ? hash(readFileSync(join(root, f), "utf8")) : "MISSING"}`,
      )
      .join("\0"),
  );
}
interface CommandResult {
  command: string[];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}
interface Experiment {
  id: string;
  expected: MutationStatus;
  status: MutationStatus;
  reason?: string;
  baseline?: CommandResult;
  detector?: CommandResult;
  postBaseline?: CommandResult;
  diff?: string;
  sourceBefore?: string;
  sourceAfter?: string;
  compiledFingerprint?: string;
  firstMismatchTick?: number | null;
  failingChecks?: DetectorReport["checks"];
  witness?: { baseline: unknown; mutant: unknown };
  commands: CommandResult[];
  elapsedMs: number;
  cleanup: {
    passed: boolean;
    worktreeRemoved: boolean;
    directoryRemoved: boolean;
    sourceUnchanged: boolean;
  };
}
export interface RunnerOptions {
  root: string;
  mutations: readonly Mutation[];
  strict: boolean;
  repeats: number;
  // Internal test seam; unavailable through CLI or external JSON.
  fault?: "after-mutation";
  signal?: AbortSignal;
}
const witnessCode = `import {createWorld,PLAYER_TEAM,PVE_TEAM,spawnSoldier} from './packages/simulation/dist/index.js';
import {isValidCombatTarget} from './packages/simulation/dist/systems/combat.js';
const w=createWorld({seed:59}); const s=spawnSoldier(w,{x:0,y:0},PLAYER_TEAM);
const t=w.createEntity({kind:'UNIT',definitionId:'probe'}); w.teams.set(t,{teamId:PVE_TEAM});
w.health.set(t,{current:40,max:40}); w.attacks.set(s,{...w.attacks.get(s),allowedTargets:[]});
console.log(JSON.stringify({forbiddenTargetAccepted:isValidCombatTarget(w,s,t)}));`;

export async function runMutationMatrix(options: RunnerOptions) {
  const root = realpathSync(options.root);
  const commit = git(root, ["rev-parse", "HEAD"]);
  if (git(root, ["status", "--porcelain"]))
    throw new Error("Commit tooling first: baseline source must be clean");
  const initial = sourceFingerprint(root);
  const start = performance.now();
  const output = join(root, ".artifacts/verification/at4", randomUUID());
  mkdirSync(output, { recursive: true });
  const results: Experiment[] = [];
  for (let repeat = 1; repeat <= options.repeats; repeat++) {
    for (const mutation of options.mutations) {
      if (options.signal?.aborted) break;
      const began = performance.now();
      const temp = realpathSync(mkdtempSync(join(tmpdir(), "web-rts-at4-")));
      const owner = randomUUID();
      writeFileSync(join(temp, "owner"), owner);
      const disposable = join(temp, "checkout");
      const e: Experiment = {
        id: mutation.id,
        expected: mutation.expected,
        status: "SETUP_ERROR",
        commands: [],
        elapsedMs: 0,
        cleanup: {
          passed: false,
          worktreeRemoved: false,
          directoryRemoved: false,
          sourceUnchanged: false,
        },
      };
      let registered = false;
      const command = async (executable: string, args: string[]): Promise<CommandResult> => {
        const began = performance.now();
        const r = await new Promise<CommandResult>((fulfill) => {
          const child = spawn(executable, args, {
            cwd: disposable,
            detached: true,
            env: {
              ...process.env,
              CI: "true",
              TMPDIR: temp,
              XDG_CACHE_HOME: join(temp, "cache"),
              npm_config_cache: join(temp, "npm-cache"),
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "",
            stderr = "",
            stopped = false;
          const stop = () => {
            stopped = true;
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                /* already exited */
              }
            }
          };
          const timer = setTimeout(stop, 180000);
          options.signal?.addEventListener("abort", stop, { once: true });
          child.stdout.on("data", (b) => {
            stdout += String(b);
            if (stdout.length > 2000000) stop();
          });
          child.stderr.on("data", (b) => {
            stderr += String(b);
            if (stderr.length > 2000000) stop();
          });
          const finish = (exitCode: number | null, signal: string | null) => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", stop);
            fulfill({
              command: [executable, ...args],
              exitCode: stopped ? null : exitCode,
              signal,
              stdout,
              stderr,
              elapsedMs: performance.now() - began,
            });
          };
          child.on("error", (error) => {
            stderr += error.message;
            finish(null, null);
          });
          child.on("close", finish);
          if (options.signal?.aborted) stop();
        });
        e.commands.push(r);
        return r;
      };
      const required = async (executable: string, args: string[]) => {
        const r = await command(executable, args);
        if (r.exitCode !== 0)
          throw new Error(
            `Setup command failed: ${r.command.join(" ")} (${r.exitCode}, ${r.signal})`,
          );
        return r;
      };
      const build = async () => {
        // No Turbo, no shared output, no incremental files; all dependencies rebuilt.
        for (const dir of [
          "packages/game-data",
          "packages/simulation",
          "packages/protocol",
          "packages/match-adapter",
          "packages/testkit",
          "tools/scenario-runner",
        ])
          rmSync(join(disposable, dir, "dist"), { recursive: true, force: true });
        await required("pnpm", ["--filter", "@web-rts/scenario-runner...", "-r", "run", "build"]);
      };
      const detect = () =>
        command(process.execPath, ["tools/scenario-runner/dist/cli.js", mutation.scenario]);
      try {
        git(root, ["worktree", "add", "--detach", disposable, commit]);
        registered = true;
        if (
          git(disposable, ["status", "--porcelain"]) ||
          git(disposable, ["rev-parse", "HEAD"]) !== commit
        )
          throw new Error("Unclean disposable baseline");
        await required("pnpm", [
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--store-dir",
          join(temp, "store"),
        ]);
        await build();
        e.baseline = await detect();
        const baseline = JSON.parse(e.baseline.stdout) as DetectorReport;
        if (e.baseline.exitCode !== 0 || baseline.status !== "PASS")
          throw new Error("Baseline did not PASS");
        let witnessBaseline: unknown;
        if (mutation.id === "targetability")
          witnessBaseline = JSON.parse(
            (await required(process.execPath, ["--input-type=module", "-e", witnessCode])).stdout,
          );
        const file = join(disposable, mutation.file);
        if (
          realpathSync(dirname(file)) !== resolve(disposable, dirname(mutation.file)) ||
          !file.startsWith(disposable + "/packages/simulation/src/")
        )
          throw new Error("Unsafe source path");
        const before = readFileSync(file, "utf8"),
          after = replaceAnchor(before, mutation);
        e.sourceBefore = hash(before);
        e.sourceAfter = hash(after);
        writeFileSync(file, after);
        if (
          readFileSync(file, "utf8") !== after ||
          git(disposable, ["diff", "--name-only"]) !== mutation.file ||
          git(disposable, ["ls-files", "--others", "--exclude-standard"])
        )
          throw new Error("Unexpected changed files");
        e.diff = git(disposable, ["diff", "--", mutation.file]);
        if (options.fault === "after-mutation") throw new Error("Injected failure after mutation");
        await build();
        const compiledPath = join(
          disposable,
          mutation.file.replace("/src/", "/dist/").replace(/\.ts$/, ".js"),
        );
        const compiled = readFileSync(compiledPath, "utf8");
        // These explicit catalog replacements survive TS compilation verbatim.
        if (!compiled.includes(mutation.replacement) || compiled.includes(mutation.anchor))
          throw new Error("Mutation absent from executable JS");
        e.compiledFingerprint = hash(compiled);
        if (mutation.id === "targetability") {
          const mutant = JSON.parse(
            (await required(process.execPath, ["--input-type=module", "-e", witnessCode])).stdout,
          );
          e.witness = { baseline: witnessBaseline, mutant };
          if (
            JSON.stringify(witnessBaseline) !== '{"forbiddenTargetAccepted":false}' ||
            JSON.stringify(mutant) !== '{"forbiddenTargetAccepted":true}'
          )
            throw new Error("Survivor execution witness failed");
        }
        e.detector = await detect();
        const report = JSON.parse(e.detector.stdout) as DetectorReport;
        e.status = classifyDetector(baseline, report, e.detector.exitCode, mutation);
        e.firstMismatchTick = report.firstMismatchTick;
        e.failingChecks = report.checks?.filter((c) => c.status === "FAIL");
        // Restore disposable source, rebuild everything, and rerun the detector.
        writeFileSync(file, before);
        if (git(disposable, ["status", "--porcelain"])) throw new Error("Restore is not clean");
        await build();
        e.postBaseline = await detect();
        if (e.postBaseline.exitCode !== 0 || e.postBaseline.stdout !== e.baseline.stdout)
          throw new Error("Restored baseline differs");
      } catch (error) {
        e.status = "SETUP_ERROR";
        e.reason = String(error);
      } finally {
        try {
          if (readFileSync(join(temp, "owner"), "utf8") !== owner || realpathSync(temp) !== temp)
            throw new Error("Cleanup ownership mismatch");
          if (registered) git(root, ["worktree", "remove", "--force", disposable]);
          e.cleanup.worktreeRemoved =
            !git(root, ["worktree", "list", "--porcelain"]).includes(`worktree ${disposable}\n`) &&
            !existsSync(disposable);
          if (!e.cleanup.worktreeRemoved) throw new Error("Disposable worktree remains");
          rmSync(temp, { recursive: true });
          e.cleanup.directoryRemoved = !existsSync(temp);
          e.cleanup.sourceUnchanged = sourceFingerprint(root) === initial;
          e.cleanup.passed =
            e.cleanup.worktreeRemoved && e.cleanup.directoryRemoved && e.cleanup.sourceUnchanged;
          if (!e.cleanup.passed) throw new Error("Source fingerprint changed");
        } catch (error) {
          e.status = "SETUP_ERROR";
          e.reason = `${e.reason ?? ""}; cleanup: ${error}`;
        }
        e.elapsedMs = performance.now() - began;
        results.push(e);
        writeFileSync(join(output, `${mutation.id}-${repeat}.json`), JSON.stringify(e, null, 2));
      }
    }
  }
  const complete = results.length === options.repeats * options.mutations.length;
  const report = {
    schemaVersion: 1,
    commit,
    node: process.version,
    output,
    elapsedMs: performance.now() - start,
    strict: options.strict,
    complete,
    diagnosticMatched:
      complete &&
      evaluateMatrix(
        results.map((r) => ({ ...r, cleanup: r.cleanup.passed })),
        false,
      ),
    detectionGatePassed:
      complete &&
      evaluateMatrix(
        results.map((r) => ({ ...r, cleanup: r.cleanup.passed })),
        true,
      ),
    results,
  };
  writeFileSync(join(output, "matrix.json"), JSON.stringify(report, null, 2));
  return report;
}
