/** JSON-safe values kept separate from runtime diagnostics and mutable World stores. */
export type EvidenceValue =
  | null
  | boolean
  | number
  | string
  | readonly EvidenceValue[]
  | { readonly [key: string]: EvidenceValue };

export interface GameplayCheck {
  id: string;
  tick: number;
  expected: EvidenceValue;
  actual: EvidenceValue;
}

export interface GameplayScenario {
  scenarioId: string;
  seed: number;
  ticks: number;
  inputs: EvidenceValue;
  execute(): { checks: readonly GameplayCheck[]; observations: EvidenceValue };
}

/** Object key insertion order is irrelevant; array/command order is significant. */
function canonical(value: EvidenceValue): string {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Evidence numbers must be finite");
  if (value === undefined) throw new Error("Evidence cannot contain undefined");
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Runs real gameplay once and checks concrete outcomes, never repeatability alone. */
export function verifyGameplay(scenario: GameplayScenario) {
  canonical(scenario.inputs);
  if (
    !Number.isSafeInteger(scenario.ticks) ||
    scenario.ticks < 0 ||
    scenario.ticks > 1000 ||
    !Number.isSafeInteger(scenario.seed)
  )
    throw new Error("Invalid scenario tick/seed bounds");
  const { checks, observations } = scenario.execute();
  canonical(observations);
  if (checks.length > 128) throw new Error("Check cap exceeded");
  const ids = new Set<string>();
  for (const check of checks) {
    if (!check.id || ids.has(check.id)) throw new Error("Duplicate/empty assertion id");
    ids.add(check.id);
    if (!Number.isSafeInteger(check.tick) || check.tick < 0 || check.tick > scenario.ticks)
      throw new Error("Invalid checkpoint tick");
  }
  if (checks.length === 0) throw new Error("Scenario must supply at least one gameplay check");
  const results = checks.map((check) => {
    const status = canonical(check.expected) === canonical(check.actual) ? "PASS" : "FAIL";
    return {
      ...check,
      status,
      ...(status === "FAIL"
        ? { reason: `Expected ${canonical(check.expected)}, observed ${canonical(check.actual)}` }
        : {}),
    };
  });
  const report = {
    schemaVersion: 1,
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    ticks: scenario.ticks,
    inputs: scenario.inputs,
    status: results.every((check) => check.status === "PASS") ? "PASS" : "FAIL",
    firstMismatchTick: results.some((check) => check.status === "FAIL")
      ? Math.min(...results.filter((check) => check.status === "FAIL").map((check) => check.tick))
      : null,
    checks: results,
    observations,
  };
  if (new TextEncoder().encode(JSON.stringify(report, null, 2)).length > 262144)
    throw new Error("Evidence output cap exceeded");
  return report;
}
