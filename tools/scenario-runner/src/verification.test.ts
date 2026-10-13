import { describe, expect, it } from "vitest";
import { verifyGameplay } from "@web-rts/testkit";
import { gameplayScenario } from "./verification-scenarios.js";
import { runVerificationCli } from "./verify-cli.js";

describe("gameplay verification gate", () => {
  for (const id of ["move", "combat"]) {
    it(`${id} checks real outcomes and produces repeatable evidence`, () => {
      const first = verifyGameplay(gameplayScenario(id));
      expect(first.status).toBe("PASS");
      expect(first.checks.length).toBeGreaterThan(0);
      for (let repeat = 0; repeat < 4; repeat += 1)
        expect(verifyGameplay(gameplayScenario(id))).toEqual(first);
      expect(runVerificationCli([id]).exitCode).toBe(0);
    });
  }
  it("detects wrong expectations with expected/actual and checkpoint tick", () => {
    const scenario = gameplayScenario("move");
    const execute = scenario.execute;
    scenario.execute = () => {
      const result = execute();
      return {
        ...result,
        checks: result.checks.map((check) =>
          check.id === "arrived-at-target" ? { ...check, expected: { x: 999, y: -3 } } : check,
        ),
      };
    };
    const report = verifyGameplay(scenario);
    expect(report.status).toBe("FAIL");
    expect(report.firstMismatchTick).toBe(120);
    expect(report.checks.find((check) => check.id === "arrived-at-target")?.reason).toContain(
      "999",
    );
  });
  it("detects corrupted observed state rather than comparing two identical broken runs", () => {
    const scenario = gameplayScenario("combat");
    const execute = scenario.execute;
    scenario.execute = () => {
      const result = execute();
      return {
        ...result,
        checks: result.checks.map((check) =>
          check.id === "enemy-killed" ? { ...check, actual: true } : check,
        ),
      };
    };
    expect(verifyGameplay(scenario).status).toBe("FAIL");
  });
  it("rejects non-finite evidence instead of treating NaN as JSON null", () => {
    expect(() =>
      verifyGameplay({
        scenarioId: "invalid",
        seed: 1,
        ticks: 1,
        inputs: null,
        execute: () => ({
          checks: [{ id: "health", tick: 1, expected: null, actual: Number.NaN }],
          observations: null,
        }),
      }),
    ).toThrow("finite");
  });
  it("fails closed for empty checks and unknown or malformed CLI requests", () => {
    expect(() =>
      verifyGameplay({
        scenarioId: "empty",
        seed: 1,
        ticks: 1,
        inputs: null,
        execute: () => ({ checks: [], observations: null }),
      }),
    ).toThrow("at least one");
    for (const args of [[], ["missing"], ["move", "extra"]]) {
      const result = runVerificationCli(args);
      expect(result.exitCode).toBe(2);
      expect(result.report).toMatchObject({ status: "FAIL" });
    }
  });
});
