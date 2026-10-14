import { MUTATIONS } from "./mutation-catalog.js";
import { runMutationMatrix } from "./mutation-runner.js";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  if (args.length === 1 && args[0] === "--list") {
    console.log(
      JSON.stringify(
        MUTATIONS.map((m) => ({ ...m, reproduce: `pnpm verify:mutation ${m.id}` })),
        null,
        2,
      ),
    );
  } else {
    const strict = args.includes("--strict");
    const repeatArg = args.find((a) => a.startsWith("--repeats="));
    const repeats = repeatArg ? Number(repeatArg.split("=")[1]) : 1;
    const ids = args.filter((a) => !a.startsWith("--"));
    if (
      args.some((a) => a.startsWith("--") && a !== "--strict" && a !== repeatArg) ||
      !Number.isInteger(repeats) ||
      repeats < 1 ||
      repeats > 3 ||
      !ids.length ||
      new Set(ids).size !== ids.length ||
      (ids.includes("all") && ids.length !== 1)
    )
      throw new Error("Usage: pnpm verify:mutation <all|IDs> [--strict] [--repeats=1..3]");
    const mutations =
      ids[0] === "all"
        ? MUTATIONS
        : ids.map((id) => {
            const m = MUTATIONS.find((m) => m.id === id);
            if (!m) throw new Error(`Unknown mutation: ${id}`);
            return m;
          });
    const report = await runMutationMatrix({
      root: fileURLToPath(new URL("../../../", import.meta.url)),
      mutations,
      strict,
      repeats,
      signal: controller.signal,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = (strict ? report.detectionGatePassed : report.diagnosticMatched) ? 0 : 1;
  }
} catch (error) {
  const reason = String(error);
  console.log(JSON.stringify({ schemaVersion: 1, status: "SETUP_ERROR", reason }));
  console.error(reason);
  process.exitCode = 2;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
