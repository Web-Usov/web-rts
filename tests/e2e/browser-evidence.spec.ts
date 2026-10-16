import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type TestInfo,
} from "@playwright/test";
import {
  artifactBudgetExceeded,
  artifactLimits,
  boundedJson,
  BrowserEvidence,
  EVIDENCE_LIMITS,
  GREEN_LIMITS,
  hasReplayArtifacts,
  needsReplay,
  REQUIRED_CHECKS,
  reportStatus,
  retainReplay,
  type BrowserCheck,
} from "./helpers/browser-evidence.js";
import { runBrowserSession } from "./helpers/browser-session.js";

// Auto-tracing would already own tracing on fixture contexts; the harness manages its own.
test.use({ trace: "off", video: "off" });

function complete(): BrowserCheck[] {
  return REQUIRED_CHECKS.local.map((id) => ({
    id,
    expected: true,
    actual: true,
    status: "PASS",
    reason: "fixture",
  }));
}
test("AT7 evidence fails closed on missing/invalid assertions, errors and caps", () => {
  expect(reportStatus("local", complete(), [])).toBe("PASS");
  expect(reportStatus("local", [], [])).toBe("ERROR");
  expect(reportStatus("local", complete().slice(1), [])).toBe("ERROR");
  expect(reportStatus("local", complete(), ["pageerror"])).toBe("ERROR");
  expect(reportStatus("local", [...complete(), complete()[0]!], [])).toBe("ERROR");
  for (const actual of [null, NaN, Infinity]) {
    const checks = complete();
    checks[0]!.actual = actual;
    expect(reportStatus("local", checks, [])).toBe("ERROR");
  }
  const failed = complete();
  failed[0]!.actual = false;
  failed[0]!.status = "FAIL";
  expect(reportStatus("local", failed, [])).toBe("FAIL");
  failed[0]!.status = "PASS";
  expect(reportStatus("local", failed, [])).toBe("ERROR");
  expect(
    reportStatus(
      "local",
      Array.from({ length: 65 }, (_, i) => ({
        id: String(i),
        expected: true,
        actual: true,
        status: "PASS",
        reason: "cap",
      })),
      [],
    ),
  ).toBe("ERROR");
});

test("AT7 JSON and artifact caps cannot become PASS", () => {
  expect(boundedJson({ status: "PASS", data: "x".repeat(65536) }, "local").exceeded).toBe(true);
  expect(
    JSON.parse(boundedJson({ status: "PASS", data: "x".repeat(65536) }, "local").output).status,
  ).toBe("ERROR");
  expect(artifactBudgetExceeded([EVIDENCE_LIMITS.artifactBytes])).toBe(false);
  expect(artifactBudgetExceeded([EVIDENCE_LIMITS.artifactBytes, 1])).toBe(true);
  expect(artifactBudgetExceeded(Array(17).fill(0))).toBe(true);
  expect(artifactBudgetExceeded([NaN])).toBe(true);
});

test("AT7 replay retention and budget depend on outcome", () => {
  expect(retainReplay(false, false)).toBe(false);
  expect(retainReplay(true, false)).toBe(true);
  expect(retainReplay(false, true)).toBe(true);
  expect(artifactLimits(false)).toEqual(GREEN_LIMITS);
  expect(artifactLimits(true)).toEqual(EVIDENCE_LIMITS);
  expect(GREEN_LIMITS.artifactBytes).toBe(8 * 1024 * 1024);
  expect(artifactBudgetExceeded([GREEN_LIMITS.artifactBytes], GREEN_LIMITS)).toBe(false);
  expect(artifactBudgetExceeded([GREEN_LIMITS.artifactBytes + 1], GREEN_LIMITS)).toBe(true);
  expect(artifactBudgetExceeded([24 * 1024 * 1024], artifactLimits(true))).toBe(false);
  expect(hasReplayArtifacts(["a.png", "trace-0.zip"])).toBe(true);
  expect(hasReplayArtifacts(["video-A/x.webm"])).toBe(true);
  expect(hasReplayArtifacts(["before-A.png"])).toBe(false);
  const checks = REQUIRED_CHECKS.local.filter((id) => id !== "errors" && id !== "complete");
  const passed = (): BrowserCheck[] =>
    checks.map((id) => ({ id, expected: true, actual: true, status: "PASS", reason: "fixture" }));
  expect(needsReplay("local", passed(), [], true)).toBe(false);
  expect(needsReplay("local", passed(), [], true, new Error("x"))).toBe(true);
  expect(needsReplay("local", passed(), ["A pageerror: x"], true)).toBe(true);
  expect(needsReplay("local", passed(), [], false)).toBe(true);
  expect(needsReplay("local", passed().slice(1), [], true)).toBe(true);
  const failed = passed();
  failed[0]!.status = "FAIL";
  expect(needsReplay("local", failed, [], true)).toBe(true);
});

test.describe("AT7 early setup failure", () => {
  async function run(
    browser: Browser,
    info: TestInfo,
    newContext: (o: BrowserContextOptions) => Promise<BrowserContext>,
  ) {
    const before = browser.contexts().length;
    const directory = info.outputPath("evidence");
    const evidence = new BrowserEvidence("remote", info, directory);
    let called = false;
    const status = await runBrowserSession({
      browser,
      evidence,
      actors: ["A", "B"],
      newContext,
      body: async () => {
        called = true;
      },
    });
    const report = JSON.parse(await readFile(directory + "/evidence.json", "utf8"));
    expect(called).toBe(false);
    expect(status).toBe("ERROR");
    expect(report.status).toBe("ERROR");
    expect(report.reference).not.toBeNull();
    expect(browser.contexts().length).toBe(before);
    return report as { errors: string[] };
  }

  test("newContext failure on the second context closes the first and reports ERROR", async ({
    browser,
  }, info) => {
    let calls = 0;
    const report = await run(browser, info, async (options) => {
      if (++calls === 2) throw new Error("injected newContext failure");
      return browser.newContext(options);
    });
    expect(report.errors.join("\n")).toContain("injected newContext failure");
  });

  test("tracing.start failure still closes the context and reports ERROR", async ({
    browser,
  }, info) => {
    const report = await run(browser, info, async (options) => {
      const context = await browser.newContext(options);
      (context.tracing as { start: unknown }).start = async () => {
        throw new Error("injected tracing.start failure");
      };
      return context;
    });
    expect(report.errors.join("\n")).toContain("injected tracing.start failure");
  });
});
