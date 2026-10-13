import { verifyGameplay } from "@web-rts/testkit";
import { gameplayScenario } from "./verification-scenarios.js";

/** JSON alone goes to stdout; human diagnostics go to stderr. */
export function runVerificationCli(args: readonly string[]): {
  exitCode: number;
  report: unknown;
  summary: string;
} {
  try {
    if (args.length !== 1) throw new Error("Usage: pnpm verify:gameplay <move|combat>");
    const report = verifyGameplay(gameplayScenario(args[0]!));
    return {
      exitCode: report.status === "PASS" ? 0 : 1,
      report,
      summary: `${report.status} ${report.scenarioId}: ${report.checks.filter((check) => check.status === "PASS").length}/${report.checks.length} checks`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      report: { schemaVersion: 1, scenarioId: args[0] ?? null, status: "FAIL", reason },
      summary: `FAIL: ${reason}`,
    };
  }
}
