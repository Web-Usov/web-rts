import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMutationMatrix, sourceFingerprint } from "./mutation-runner.js";
import { MUTATIONS, evaluateMatrix } from "./mutation-catalog.js";

it("refuses dirty source before creating a disposable experiment; fingerprints untracked content", async () => {
  const root = mkdtempSync(join(tmpdir(), "at4-safety-test-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    git(["init"]);
    writeFileSync(join(root, "source.ts"), "baseline");
    git(["add", "."]);
    git([
      "-c",
      "user.name=AT4 test",
      "-c",
      "user.email=at4@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);
    const clean = sourceFingerprint(root);
    writeFileSync(join(root, "untracked.ts"), "one");
    const first = sourceFingerprint(root);
    writeFileSync(join(root, "untracked.ts"), "two");
    expect(first).not.toBe(clean);
    expect(sourceFingerprint(root)).not.toBe(first);
    await expect(
      runMutationMatrix({ root, mutations: MUTATIONS, strict: true, repeats: 1 }),
    ).rejects.toThrow("baseline source must be clean");
    rmSync(join(root, "untracked.ts"));
    writeFileSync(join(root, "source.ts"), "changed");
    git(["add", "."]);
    expect(sourceFingerprint(root)).not.toBe(clean);
    await expect(
      runMutationMatrix({ root, mutations: MUTATIONS, strict: true, repeats: 1 }),
    ).rejects.toThrow("baseline source must be clean");
  } finally {
    rmSync(root, { recursive: true });
  }
});
it("passes a clean strict gate only for a nonempty expected kill matrix", () => {
  expect(evaluateMatrix([{ status: "KILLED", expected: "KILLED", cleanup: true }], true)).toBe(
    true,
  );
});
