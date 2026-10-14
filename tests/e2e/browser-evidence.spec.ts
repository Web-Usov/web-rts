import { expect, test } from "@playwright/test";
import {
  artifactBudgetExceeded,
  boundedJson,
  EVIDENCE_LIMITS,
  REQUIRED_CHECKS,
  reportStatus,
  type BrowserCheck,
} from "./helpers/browser-evidence.js";

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
