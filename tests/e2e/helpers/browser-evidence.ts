import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export type Mode = "local" | "remote";
export const EVIDENCE_LIMITS = {
  jsonBytes: 65536,
  artifactBytes: 128 * 1024 * 1024,
  files: 16,
} as const;
export function artifactBudgetExceeded(sizes: number[]): boolean {
  return (
    sizes.length > EVIDENCE_LIMITS.files ||
    sizes.some((size) => !Number.isSafeInteger(size) || size < 0) ||
    sizes.reduce((sum, size) => sum + size, 0) > EVIDENCE_LIMITS.artifactBytes
  );
}
export function boundedJson(report: unknown, mode: Mode): { output: string; exceeded: boolean } {
  const output = JSON.stringify(report, null, 2) + "\n";
  if (Buffer.byteLength(output) <= EVIDENCE_LIMITS.jsonBytes) return { output, exceeded: false };
  return {
    output: JSON.stringify({
      schemaVersion: 1,
      scenarioId: "move",
      mode,
      status: "ERROR",
      errors: ["evidence exceeded 65536 bytes; report omitted"],
    }),
    exceeded: true,
  };
}
type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export interface BrowserCheck {
  id: string;
  expected: Value;
  actual: Value;
  status: "PASS" | "FAIL";
  reason: string;
}
export const REQUIRED_CHECKS = {
  local: [
    "running-A",
    "objective-before-A",
    "selection-A",
    "destination-A",
    "movement-A",
    "objective-after-A",
    "event-A",
    "worker",
    "no-game-socket",
    "errors",
    "complete",
  ],
  remote: [
    "running-A",
    "running-B",
    "objective-before-A",
    "objective-before-B",
    "selection-A",
    "foreign-hit-proof",
    "foreign-selection",
    "foreign-destination",
    "foreign-stationary",
    "destination-A",
    "movement-A",
    "movement-B",
    "objective-after-A",
    "objective-after-B",
    "event-A",
    "event-B",
    "errors",
    "complete",
  ],
} as const;

/** Fail closed: missing checks/observations, duplicates, non-finite numbers and caps are errors. */
export function reportStatus(
  mode: Mode,
  checks: BrowserCheck[],
  errors: string[],
): "PASS" | "FAIL" | "ERROR" {
  if (
    errors.length ||
    checks.length > 64 ||
    new Set(checks.map((c) => c.id)).size !== checks.length ||
    REQUIRED_CHECKS[mode].some((id) => !checks.some((c) => c.id === id))
  )
    return "ERROR";
  for (const check of checks) {
    const valid = (value: unknown): boolean => {
      if (value === undefined || value === null) return false;
      if (typeof value === "number") return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(valid);
      if (typeof value === "object") return Object.values(value).every(valid);
      return typeof value === "string" || typeof value === "boolean";
    };
    if (!valid(check.expected) || !valid(check.actual)) return "ERROR";
    const equal = JSON.stringify(check.expected) === JSON.stringify(check.actual);
    if ((check.status === "PASS") !== equal) return "ERROR";
  }
  return checks.some((c) => c.status === "FAIL") ? "FAIL" : "PASS";
}

/** Node-side harness only; browser observations use HUD and screenshot pixels. */
export class BrowserEvidence {
  readonly checks: BrowserCheck[] = [];
  readonly actions: Value[] = [];
  readonly observations: Value[] = [];
  readonly errors: string[] = [];
  readonly artifacts: string[] = [];
  readonly started = Date.now();
  readonly samples: Value[] = [];
  private overflow = false;
  private readonly directory: string;
  constructor(
    readonly mode: Mode,
    private readonly info: TestInfo,
  ) {
    this.directory = path.resolve(
      process.env.AT7_EVIDENCE_DIR ?? ".artifacts/verification/at7",
      info.testId + "-repeat-" + info.repeatEachIndex + "-retry-" + info.retry,
    );
  }
  captureErrors(page: Page, actor: string) {
    const capture = (kind: string, message: string) => {
      if (this.errors.length < 32) this.errors.push(`${actor} ${kind}: ${message.slice(0, 1024)}`);
      else this.overflow = true;
    };
    page.on("pageerror", (error) => capture("pageerror", error.message));
    page.on("console", (message) => {
      if (message.type() === "error") capture("console", message.text());
    });
    page.on("crash", () => capture("runtime", "page crashed"));
  }
  check(id: string, expected: Value, actual: Value, reason: string) {
    const status = JSON.stringify(expected) === JSON.stringify(actual) ? "PASS" : "FAIL";
    this.checks.push({ id, expected, actual, status, reason });
    if (this.checks.length > 64) throw new Error("check cap exceeded");
  }
  action(actor: string, action: string, details: Value = {}) {
    this.actions.push({ actor, action, details });
    if (this.actions.length > 32) throw new Error("action cap exceeded");
  }
  observe(actor: string, stage: string, values: Value) {
    this.observations.push({ actor, stage, values });
    if (this.observations.length > 64) throw new Error("observation cap exceeded");
  }
  async artifactPath(name: string) {
    await mkdir(this.directory, { recursive: true });
    return path.join(this.directory, name);
  }
  sample(actor: string, stage: string, values: Value) {
    this.samples.push({ actor, stage, values });
    if (this.samples.length > 32) throw new Error("run sample cap exceeded");
  }
  recordArtifact(file: string) {
    this.artifacts.push(path.relative(this.directory, file));
  }
  async shot(page: Page, name: string) {
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, name + ".png");
    await page.screenshot({ path: file, timeout: 5000 });
    this.artifacts.push(name + ".png");
    await this.info.attach(name, { path: file, contentType: "image/png" });
  }
  async finish(failure?: unknown) {
    if (failure) this.errors.push(String(failure).slice(0, 2048));
    if (this.overflow) this.errors.push("error cap exceeded; messages omitted");
    const fixturePath = "tools/scenario-runner/scenarios/move.json";
    const text = await readFile(fixturePath, "utf8");
    const fixture = JSON.parse(text);
    const artifactSizes: number[] = [];
    for (const file of this.artifacts) {
      try {
        artifactSizes.push((await stat(path.resolve(this.directory, file))).size);
      } catch {
        this.errors.push("missing artifact: " + file);
      }
    }
    if (artifactBudgetExceeded(artifactSizes))
      this.errors.push("artifact budget exceeded (16 files / 128 MiB)");
    this.check("errors", [], this.errors, "strict console/page/runtime capture");
    this.check("complete", true, !failure && !this.overflow, "all public actions completed");
    let status = reportStatus(this.mode, this.checks, this.errors);
    if (!this.actions.length || !this.observations.length) status = "ERROR";
    const report = {
      schemaVersion: 1,
      scenarioId: "move",
      mode: this.mode,
      reference: {
        path: fixturePath,
        sha256: createHash("sha256").update(text).digest("hex"),
        seed: fixture.seed,
        ticks: fixture.ticks,
        setup: fixture.setup,
        commands: fixture.operations.filter((op: { type: string }) => op.type === "move"),
        expectations: fixture.operations.filter((op: { type: string }) => op.type === "check"),
      },
      setup: {
        entry: this.mode === "local" ? "/?transport=local" : "/",
        players: this.mode === "local" ? 1 : 2,
        viewport: { width: 1280, height: 720 },
        seedControl: "unavailable in UI",
        mapControl: "unavailable in UI",
      },
      actions: this.actions,
      observations: this.observations,
      checks: this.checks,
      parity: [
        {
          level: "semantic",
          supported: true,
          comparisons: [
            "owned MOVE causes rendered displacement",
            "control preserved for subsequent owned MOVE",
          ],
          reason: "same gameplay intention; pixel displacement is not simulation equality",
        },
        {
          level: "exact",
          supported: false,
          comparisons: ["seed", "participants", "target", "command tick", "snapshot", "events"],
          reason:
            "UI uses seed=1; Remote has two participants; no public world-target/tick scheduler or snapshot observation",
        },
        {
          level: "browser-regression",
          supported: true,
          comparisons:
            this.mode === "remote"
              ? ["objective persistence", "foreign control blocked by UI"]
              : ["objective persistence"],
          reason: "additional browser checks; AT3 move.json does not assert objective persistence",
        },
      ],
      errors: this.errors,
      artifacts: this.artifacts,
      run: {
        startedAt: new Date(this.started).toISOString(),
        durationMs: Date.now() - this.started,
        repeat: this.info.repeatEachIndex,
        retry: this.info.retry,
        browser: this.info.project.use.browserName ?? "chromium",
        project: this.info.project.name,
        node: process.version,
        samples: this.samples,
        artifactBytes: artifactSizes.reduce((sum, size) => sum + size, 0),
      },
      status,
    };
    const { output, exceeded } = boundedJson(report, this.mode);
    if (exceeded) status = "ERROR";
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, "evidence.json");
    await writeFile(file, output);
    await this.info.attach("browser-evidence", { path: file, contentType: "application/json" });
    return status;
  }
}
