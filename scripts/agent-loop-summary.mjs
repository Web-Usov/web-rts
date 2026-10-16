#!/usr/bin/env node
// AT8: versioned summary of a Coding Agent feedback-loop run. Offline tooling only.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 1;
const MODES = ["baseline", "treatment"];
const STATUSES = ["PASS", "FAIL", "ERROR"];

export function validateSummary(s) {
  const errors = [];
  const need = (cond, msg) => {
    if (!cond) errors.push(msg);
  };
  const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  need(obj(s), "summary must be an object");
  if (!obj(s)) return errors;
  need(s.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`);
  need(typeof s.issue === "number", "issue must be a number");
  need(/^[0-9a-f]{40}$/.test(s.baseCommit ?? ""), "baseCommit must be a 40-hex SHA");
  need(MODES.includes(s.mode), `mode must be one of ${MODES.join("|")}`);
  need(obj(s.environment) && typeof s.environment.model === "string", "environment.model required");
  need(Array.isArray(s.contextSources), "contextSources must be an array");
  need(Array.isArray(s.kbNotes), "kbNotes must be an array");
  need(Array.isArray(s.commands) && s.commands.length > 0, "commands must be a non-empty array");
  for (const [i, c] of (Array.isArray(s.commands) ? s.commands : []).entries()) {
    need(typeof c?.cmd === "string" && c.cmd, `commands[${i}].cmd required`);
    need(STATUSES.includes(c?.status), `commands[${i}].status must be ${STATUSES.join("|")}`);
  }
  const f = s.failure;
  need(obj(f), "failure required");
  if (obj(f)) {
    need(typeof f.scenario === "string", "failure.scenario required");
    need(Array.isArray(f.checkpoints), "failure.checkpoints must be an array");
    need(
      f.firstMismatchTick === null || Number.isInteger(f.firstMismatchTick),
      "failure.firstMismatchTick must be integer|null",
    );
  }
  need(
    obj(s.diagnosis) && typeof s.diagnosis.rootCause === "string",
    "diagnosis.rootCause required",
  );
  need(
    obj(s.fix) && /^[0-9a-f]{64}$/.test(s.fix.diffSha256 ?? ""),
    "fix.diffSha256 must be SHA-256 hex",
  );
  need(Array.isArray(s.retest) && s.retest.length > 0, "retest must be a non-empty array");
  need(Number.isInteger(s.iterations) && s.iterations >= 0, "iterations must be integer >= 0");
  need(
    Number.isFinite(s.elapsedSeconds) && s.elapsedSeconds >= 0,
    "elapsedSeconds must be a finite number >= 0",
  );
  const t = s.tokens;
  need(
    obj(t) &&
      (t.status === "not_measured" ||
        (t.status === "measured" &&
          typeof t.source === "string" &&
          t.source.trim() !== "" &&
          Number.isInteger(t.total) &&
          t.total >= 0)),
    "tokens must be {status:'not_measured'} or measured with source and integer total",
  );
  need(Array.isArray(s.artifacts), "artifacts must be an array");
  need(Array.isArray(s.limitations), "limitations must be an array");
  need(obj(s.cleanup) && typeof s.cleanup.clean === "boolean", "cleanup.clean required");
  need(typeof s.readyForReview === "boolean", "readyForReview must be boolean");
  // Readiness (beyond structure): a review-ready handoff needs a clean cleanup and a fully passing retest.
  if (s.readyForReview === true) {
    need(s.cleanup?.clean === true, "readyForReview requires cleanup.clean === true");
    const retest = Array.isArray(s.retest) ? s.retest : [];
    need(
      retest.length > 0 && retest.every((r) => r?.status === "PASS"),
      "readyForReview requires every retest status to be PASS",
    );
  }
  return errors;
}

export function renderHandoff(s) {
  const cmds = s.commands.map((c) => `- \`${c.cmd}\` → ${c.status}`).join("\n");
  const retest = s.retest.map((r) => `- \`${r.cmd}\` → ${r.status}`).join("\n");
  const tok =
    s.tokens.status === "measured" ? `${s.tokens.total} (${s.tokens.source})` : "not_measured";
  return [
    `**Feedback-loop (${s.mode})** — issue #${s.issue}, base \`${s.baseCommit.slice(0, 10)}\``,
    `- Сбой: \`${s.failure.scenario}\`, checkpoints: ${s.failure.checkpoints.join(", ") || "—"}, firstMismatchTick: ${s.failure.firstMismatchTick}`,
    `- Root cause: ${s.diagnosis.rootCause}`,
    `- Fix: diff sha256 \`${s.fix.diffSha256.slice(0, 12)}\``,
    `- Итерации: ${s.iterations}, elapsed: ${s.elapsedSeconds}s, tokens: ${tok}`,
    `- Cleanup: ${s.cleanup.clean ? "clean" : "NOT clean"}; review-ready: ${s.readyForReview}`,
    "",
    "Команды:",
    cmds,
    "",
    "Retest:",
    retest,
    ...(s.limitations.length ? ["", "Ограничения:", ...s.limitations.map((l) => `- ${l}`)] : []),
  ].join("\n");
}

function main(argv) {
  const [cmd, file] = argv;
  if (!["validate", "render"].includes(cmd) || !file) {
    console.error("usage: agent-loop-summary.mjs validate|render <summary.json>");
    return 2;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`cannot read summary: ${e.message}`);
    return 2;
  }
  const errors = validateSummary(data);
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join("\n"));
    return 1;
  }
  console.log(cmd === "render" ? renderHandoff(data) : "OK");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exitCode = main(process.argv.slice(2));
