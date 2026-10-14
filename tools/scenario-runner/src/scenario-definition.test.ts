import { describe, expect, it } from "vitest";
import {
  definedScenario,
  matchFixture,
  parseScenarioDefinition,
  SCENARIO_LIMITS,
  verifyGameplay,
} from "@web-rts/testkit";
import {
  gameplayScenario,
  loadScenario,
  scenarioFromDefinition,
} from "./verification-scenarios.js";
import { runVerificationCli } from "./verify-cli.js";

const parse = (value: unknown) => parseScenarioDefinition(JSON.stringify(value));
describe("safe scenario definitions", () => {
  it("lists scenarios and executes permanent leave with five byte-identical runs", () => {
    expect(runVerificationCli(["--list"]).report).toMatchObject({
      scenarios: ["move", "combat", "permanent-leave"],
    });
    const first = JSON.stringify(verifyGameplay(gameplayScenario("permanent-leave")));
    expect(JSON.parse(first).status).toBe("PASS");
    for (let i = 0; i < 4; i++)
      expect(JSON.stringify(verifyGameplay(gameplayScenario("permanent-leave")))).toBe(first);
  });
  it("observes ordered same-tick checkpoints before removal, after removal and after step", () => {
    const report = verifyGameplay(gameplayScenario("permanent-leave"));
    expect(report.checks.find((c) => c.id === "pending-before-removal")).toMatchObject({
      tick: 0,
      actual: 2,
    });
    expect(report.checks.find((c) => c.id === "pending-after-removal")).toMatchObject({
      tick: 0,
      actual: 0,
    });
    expect(report.checks.find((c) => c.id === "no-movement-after-leave")).toMatchObject({
      tick: 1,
      status: "PASS",
    });
    expect(report.checks.find((c) => c.id === "grace-move-executed")).toMatchObject({
      tick: 120,
      status: "PASS",
    });
  });
  it("returns exit 1 and the early observed mismatch, with expected/actual trace", () => {
    const d = loadScenario("permanent-leave");
    const check = d.operations.find(
      (op) => op.type === "check" && op.id === "pending-before-removal",
    )!;
    if (check.type !== "check") throw new Error("missing check");
    check.expected = 999;
    const cli = runVerificationCli(["--json", JSON.stringify(d)]);
    expect(cli.exitCode).toBe(1);
    expect(cli.report).toMatchObject({
      firstMismatchTick: 0,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: check.id, expected: 999, actual: 2, status: "FAIL" }),
      ]),
    });
  });
  it("collects transient rejection every step, even when the last tick has no events", () => {
    const d = loadScenario("permanent-leave");
    d.operations = d.operations.filter(
      (op) =>
        op.type !== "removePlayer" &&
        !(op.type === "move" && op.commandId === "after-leave") &&
        !(op.type === "check" && op.id === "removed-player-rejected"),
    );
    const report = verifyGameplay(scenarioFromDefinition(d));
    expect(report.status).toBe("FAIL");
    expect(report.observations).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "COMMAND_REJECTED", commandId: "pending-invalid" }),
      ]),
    });
    expect(report.checks.find((c) => c.id === "no-stale-events")?.status).toBe("FAIL");
  });
  it.each([
    (d: ReturnType<typeof loadScenario>) => {
      d.version = 2 as 1;
    },
    (d: ReturnType<typeof loadScenario>) => {
      d.ticks = -1;
    },
    (d: ReturnType<typeof loadScenario>) => {
      d.ticks = 1001;
    },
    (d: ReturnType<typeof loadScenario>) => {
      d.operations[0]!.tick = 121;
    },
    (d: ReturnType<typeof loadScenario>) => {
      d.operations = [];
    },
    (d: ReturnType<typeof loadScenario>) => {
      d.operations.push(d.operations.at(-1)!);
    },
    (d: ReturnType<typeof loadScenario>) => {
      d.id = "../move";
    },
    (d: ReturnType<typeof loadScenario>) => {
      Object.assign(d.setup, { fixture: "../../evil.js" });
    },
    (d: ReturnType<typeof loadScenario>) => {
      Object.assign(d.operations[0]!, { type: "eval" });
    },
    (d: ReturnType<typeof loadScenario>) => {
      Object.assign(d, { unknown: true });
    },
    (d: ReturnType<typeof loadScenario>) => {
      Object.assign(d.operations[1]!, { query: { type: "entity", entity: "unit", fields: [] } });
    },
  ])("fails closed on invalid schema %#$", (mutate) => {
    const d = loadScenario("move");
    mutate(d);
    expect(() => parse(d)).toThrow();
    expect(runVerificationCli(["--json", JSON.stringify(d)]).exitCode).toBe(2);
  });
  it("rejects invalid JSON, overflow finite values, typed NaN and oversized requests", () => {
    for (const text of [
      "{",
      JSON.stringify(loadScenario("move")).replace('"expected":1', '"expected":1e309'),
      " ".repeat(SCENARIO_LIMITS.bytes + 1),
    ]) {
      expect(runVerificationCli(["--json", text]).exitCode).toBe(2);
    }
    const d = loadScenario("move");
    d.seed = Number.NaN;
    expect(() => definedScenario(d, matchFixture)).toThrow();
    expect(() => loadScenario("../move")).toThrow("Unknown scenario");
  });
  it("fails execution rather than truncating events into PASS", () => {
    const d = loadScenario("move");
    const s = definedScenario(d, (input) => {
      const driver = matchFixture(input);
      return {
        ...driver,
        drainEvents: () => Array.from({ length: 513 }, () => ({ type: "COMMAND_REJECTED" })),
      };
    });
    expect(() => verifyGameplay(s)).toThrow("Event cap");
  });
  it("fails unresolved selectors and rejects duplicate ids and invalid checkpoint ticks in legacy consumers", () => {
    const d = loadScenario("move");
    d.selectors.unit!.definitionId = "missing";
    expect(() => verifyGameplay(scenarioFromDefinition(d))).toThrow("did not resolve");
    const base = gameplayScenario("move");
    const execute = base.execute;
    base.execute = () => {
      const result = execute();
      return { ...result, checks: [...result.checks, result.checks[0]!] };
    };
    expect(() => verifyGameplay(base)).toThrow("assertion id");
  });
});

it("reports a real foreign-unit rejection with observed tick distinct from event tick", () => {
  const d = loadScenario("permanent-leave");
  d.ticks = 3;
  d.operations = [
    {
      tick: 0,
      type: "move",
      playerId: 0,
      commandId: "foreign",
      entity: "other",
      target: { x: 4, y: -3 },
    },
    {
      tick: 3,
      type: "check",
      id: "foreign-rejected",
      query: { type: "events", filter: { commandId: "foreign" } },
      expected: [
        {
          type: "COMMAND_REJECTED",
          recipientPlayerId: 0,
          commandId: "foreign",
          reason: "not_your_unit",
          tick: 0,
        },
      ],
      initial: false,
    },
  ];
  const report = verifyGameplay(scenarioFromDefinition(d));
  expect(report.checks[0]?.actual).toEqual([
    {
      type: "COMMAND_REJECTED",
      recipientPlayerId: 0,
      commandId: "foreign",
      reason: "not_your_unit",
      tick: 0,
    },
  ]);
  expect(report.status).toBe("PASS");
  expect(report.checks[0]?.tick).toBe(3);
});
it("rejects oversized evidence and invalid legacy checkpoint bounds", () => {
  const s = gameplayScenario("move");
  const execute = s.execute;
  s.execute = () => ({ ...execute(), observations: "x".repeat(SCENARIO_LIMITS.outputBytes + 1) });
  expect(() => verifyGameplay(s)).toThrow("output cap");
  s.execute = () => ({
    ...execute(),
    checks: [{ id: "bad-tick", tick: 121, expected: true, actual: true }],
  });
  expect(() => verifyGameplay(s)).toThrow("checkpoint tick");
});
