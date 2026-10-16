import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHandoff, validateSummary } from "./agent-loop-summary.mjs";

const valid = () => ({
  schemaVersion: 1,
  issue: 108,
  baseCommit: "a".repeat(40),
  mode: "treatment",
  environment: { model: "m" },
  contextSources: ["AGENTS.md"],
  kbNotes: ["permanent-leave-queue"],
  commands: [{ cmd: "pnpm verify:gameplay permanent-leave", status: "FAIL" }],
  failure: {
    scenario: "permanent-leave",
    checkpoints: ["pending-after-removal"],
    firstMismatchTick: 0,
  },
  diagnosis: {
    rootCause: "queues not deleted",
    sources: ["packages/simulation/src/match-runtime.ts"],
  },
  fix: { diffSha256: "b".repeat(64) },
  retest: [{ cmd: "pnpm verify:gameplay permanent-leave", status: "PASS" }],
  iterations: 1,
  elapsedSeconds: 10,
  tokens: { status: "not_measured" },
  artifacts: [],
  limitations: ["n=1"],
  cleanup: { clean: true },
  readyForReview: true,
});

test("valid summary passes and renders", () => {
  assert.deepEqual(validateSummary(valid()), []);
  assert.match(renderHandoff(valid()), /firstMismatchTick: 0/);
});

test("rejects bad sha, tokens and empty commands", () => {
  const s = valid();
  s.baseCommit = "x";
  s.tokens = { status: "measured" };
  s.commands = [];
  const e = validateSummary(s).join("\n");
  assert.match(e, /baseCommit/);
  assert.match(e, /tokens/);
  assert.match(e, /commands/);
});

test("rejects non-object and wrong version", () => {
  assert.ok(validateSummary(null).length);
  assert.match(validateSummary({ ...valid(), schemaVersion: 2 }).join(), /schemaVersion/);
});

test("readyForReview requires clean cleanup and all-PASS retest", () => {
  const a = valid();
  a.cleanup = { clean: false };
  assert.match(validateSummary(a).join(), /cleanup\.clean/);
  const b = valid();
  b.retest = [{ cmd: "x", status: "FAIL" }];
  assert.match(validateSummary(b).join(), /retest status/);
  b.readyForReview = false;
  assert.deepEqual(validateSummary(b), []); // unfinished experiments remain recordable
});

test("rejects negative/non-finite elapsed and bad measured tokens", () => {
  for (const v of [-1, Infinity, NaN])
    assert.match(validateSummary({ ...valid(), elapsedSeconds: v }).join(), /elapsedSeconds/);
  const t = (o) => validateSummary({ ...valid(), tokens: { status: "measured", ...o } }).join();
  assert.match(t({ source: "x", total: -1 }), /tokens/);
  assert.match(t({ source: " ", total: 5 }), /tokens/);
});
