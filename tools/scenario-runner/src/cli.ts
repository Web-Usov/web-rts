import { runVerificationCli } from "./verify-cli.js";
const result = runVerificationCli(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
process.stderr.write(`${result.summary}\n`);
process.exitCode = result.exitCode;
