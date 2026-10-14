import { describe, it, expect } from "vitest";
import {
  classifyDetector,
  evaluateMatrix,
  MUTATIONS,
  replaceAnchor,
  type DetectorReport,
} from "./mutation-catalog.js";
const m = MUTATIONS[0]!;
const pass: DetectorReport = {
  schemaVersion: 1,
  scenarioId: m.scenario,
  status: "PASS",
  checks: m.detectorIds.map((id) => ({
    id,
    status: "PASS",
    tick: 130,
    expected: null,
    actual: null,
  })),
  firstMismatchTick: null,
};
describe("targeted mutation contract", () => {
  it("requires a unique changing anchor", () => {
    expect(replaceAnchor(m.anchor, m)).toBe(m.replacement);
    expect(() => replaceAnchor("missing", m)).toThrow("exactly once");
    expect(() => replaceAnchor(m.anchor + m.anchor, m)).toThrow("exactly once");
    expect(() => replaceAnchor(m.anchor, { ...m, replacement: m.anchor })).toThrow(
      "did not change",
    );
  });
  it("kills only a designated gameplay assertion with a passing baseline", () => {
    const fail = {
      ...pass,
      status: "FAIL",
      checks: pass.checks.map((c) => ({ ...c, status: "FAIL" })),
    };
    expect(classifyDetector(pass, fail, 1, m)).toBe("KILLED");
    expect(classifyDetector(fail, fail, 1, m)).toBe("SETUP_ERROR");
    for (const exit of [2, null, 124])
      expect(classifyDetector(pass, fail, exit, m)).toBe("SETUP_ERROR");
    expect(
      classifyDetector(pass, { ...fail, checks: [{ ...fail.checks[0]!, id: "unrelated" }] }, 1, m),
    ).toBe("SETUP_ERROR");
    expect(classifyDetector(pass, { ...pass, checks: [] }, 0, m)).toBe("SETUP_ERROR");
    expect(
      classifyDetector(
        pass,
        { ...pass, checks: pass.checks.map((c) => ({ ...c, status: "FAIL" })) },
        0,
        m,
      ),
    ).toBe("SETUP_ERROR");
  });
  it("reports survivors as coverage gaps even when expected", () => {
    expect(classifyDetector(pass, pass, 0, m)).toBe("SURVIVED");
    const survivor = [
      { status: "SURVIVED" as const, expected: "SURVIVED" as const, cleanup: true },
    ];
    expect(evaluateMatrix(survivor, false)).toBe(true);
    expect(evaluateMatrix(survivor, true)).toBe(false);
    expect(evaluateMatrix([{ ...survivor[0]!, expected: "KILLED" }], false)).toBe(false);
    expect(evaluateMatrix([{ ...survivor[0]!, status: "SETUP_ERROR" }], false)).toBe(false);
    expect(evaluateMatrix([{ status: "KILLED", expected: "KILLED", cleanup: false }], true)).toBe(
      false,
    );
    expect(evaluateMatrix([], false)).toBe(false);
  });
  it("keeps catalog bounded with unique ids and known detectors", () => {
    expect(new Set(MUTATIONS.map((m) => m.id)).size).toBe(3);
    expect(
      MUTATIONS.every(
        (m) => m.file.startsWith("packages/simulation/src/") && m.detectorIds.length > 0,
      ),
    ).toBe(true);
  });
});
