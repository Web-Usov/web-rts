export type MutationStatus = "KILLED" | "SURVIVED" | "SETUP_ERROR";
export interface Mutation {
  id: string;
  file: string;
  anchor: string;
  replacement: string;
  invariant: string;
  scenario: string;
  detectorIds: readonly string[];
  expected: MutationStatus;
}
export const MUTATIONS: readonly Mutation[] = [
  {
    id: "combat-damage",
    file: "packages/simulation/src/systems/combat.ts",
    anchor: "world.health.get(targetId)!.current -= profile.damage;",
    replacement: "world.health.get(targetId)!.current -= 0;",
    invariant: "Eligible attacks reduce target health and eventually kill the enemy.",
    scenario: "combat",
    detectorIds: ["enemy-killed", "soldier-idle-after-combat"],
    expected: "KILLED",
  },
  {
    id: "leave-queue",
    file: "packages/simulation/src/match-runtime.ts",
    anchor: "this.queues.delete(playerId);",
    replacement: "this.queues.has(playerId);",
    invariant: "Permanent leave removes pending commands and prevents stale events.",
    scenario: "permanent-leave",
    detectorIds: ["pending-after-removal", "no-stale-events"],
    expected: "KILLED",
  },
  {
    id: "targetability",
    file: "packages/simulation/src/systems/combat.ts",
    anchor: "profile.allowedTargets.includes(identity.kind) &&",
    replacement: "identity.kind !== undefined &&",
    invariant: "An attack may only target kinds listed in allowedTargets.",
    scenario: "combat",
    detectorIds: ["enemy-killed", "soldier-survived", "soldier-idle-after-combat"],
    expected: "SURVIVED",
  },
];
export function replaceAnchor(source: string, mutation: Mutation): string {
  if (!mutation.anchor || source.split(mutation.anchor).length !== 2)
    throw new Error(`Anchor must occur exactly once: ${mutation.id}`);
  const result = source.replace(mutation.anchor, mutation.replacement);
  if (result === source) throw new Error("Mutation did not change source");
  return result;
}
export interface DetectorReport {
  schemaVersion: number;
  scenarioId: string;
  status: string;
  checks: { id: string; status: string; tick: number; expected: unknown; actual: unknown }[];
  firstMismatchTick: number | null;
}
export function classifyDetector(
  baseline: DetectorReport,
  mutant: DetectorReport,
  exitCode: number | null,
  mutation: Mutation,
): MutationStatus {
  const valid = (r: DetectorReport) =>
    r.schemaVersion === 1 &&
    r.scenarioId === mutation.scenario &&
    Array.isArray(r.checks) &&
    r.checks.length > 0 &&
    r.checks.every((c) => c.status === "PASS" || c.status === "FAIL") &&
    mutation.detectorIds.every((id) => r.checks.some((c) => c.id === id));
  if (
    !valid(baseline) ||
    baseline.status !== "PASS" ||
    baseline.checks.some((c) => c.status !== "PASS") ||
    !valid(mutant)
  )
    return "SETUP_ERROR";
  if (exitCode === 0 && mutant.status === "PASS" && mutant.checks.every((c) => c.status === "PASS"))
    return "SURVIVED";
  if (
    exitCode === 1 &&
    mutant.status === "FAIL" &&
    mutant.checks.some((c) => c.status === "FAIL" && mutation.detectorIds.includes(c.id))
  )
    return "KILLED";
  return "SETUP_ERROR";
}
export function evaluateMatrix(
  results: { status: MutationStatus; expected: MutationStatus; cleanup: boolean }[],
  strict: boolean,
): boolean {
  return (
    results.length > 0 &&
    results.every(
      (r) =>
        r.cleanup &&
        r.status !== "SETUP_ERROR" &&
        r.status === r.expected &&
        (!strict || r.status === "KILLED"),
    )
  );
}
