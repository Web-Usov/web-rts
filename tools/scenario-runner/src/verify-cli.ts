import { parseScenarioDefinition, SCENARIO_LIMITS, verifyGameplay } from "@web-rts/testkit";
import {
  gameplayScenario,
  scenarioFromDefinition,
  SCENARIO_IDS,
} from "./verification-scenarios.js";

/** JSON alone goes to stdout; human diagnostics go to stderr. */
export function runVerificationCli(args: readonly string[]): {
  exitCode: number;
  report: unknown;
  summary: string;
} {
  try {
    if (args.length > 2 || args.some((arg) => Buffer.byteLength(arg) > SCENARIO_LIMITS.bytes))
      throw new Error("CLI input cap exceeded");
    if (args.length === 1 && args[0] === "--list")
      return {
        exitCode: 0,
        report: { schemaVersion: 1, scenarios: SCENARIO_IDS },
        summary: SCENARIO_IDS.join(", "),
      };
    const scenario =
      args.length === 2 && args[0] === "--json"
        ? scenarioFromDefinition(parseScenarioDefinition(args[1]!))
        : args.length === 1
          ? gameplayScenario(args[0]!)
          : (() => {
              throw new Error("Usage: pnpm verify:gameplay <id|--list|--json JSON>");
            })();
    const report = verifyGameplay(scenario);
    return {
      exitCode: report.status === "PASS" ? 0 : 1,
      report,
      summary: `${report.status} ${report.scenarioId}: ${report.checks.filter((check) => check.status === "PASS").length}/${report.checks.length} checks`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      report: {
        schemaVersion: 1,
        scenarioId: args[0] && /^[a-z][a-z0-9-]{0,63}$/.test(args[0]) ? args[0] : null,
        status: "FAIL",
        reason,
      },
      summary: `FAIL: ${reason}`,
    };
  }
}
