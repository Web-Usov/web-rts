import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { MUTATIONS } from "./mutation-catalog.js";
import { runMutationMatrix } from "./mutation-runner.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
// Real disposable installs/builds are explicitly opt-in, never the required CI matrix.
describe.skipIf(process.env.AT4_INTEGRATION !== "1")("real mutation isolation", () => {
  for (const [name, anchor] of [
    ["missing", "NOT_A_REAL_ANCHOR"],
    ["ambiguous", "world.health"],
  ]) {
    it(`${name} anchor is SETUP_ERROR with cleanup`, async () => {
      const r = await runMutationMatrix({
        root,
        mutations: [{ ...MUTATIONS[0]!, anchor: anchor! }],
        repeats: 1,
        strict: true,
      });
      expect(r.results[0]!.status).toBe("SETUP_ERROR");
      expect(r.results[0]!.reason).toContain("exactly once");
      expect(r.results[0]!.cleanup.passed).toBe(true);
      expect(r.detectionGatePassed).toBe(false);
    }, 420000);
  }
  it("cleans source after an exception following the applied diff", async () => {
    const r = await runMutationMatrix({
      root,
      mutations: [MUTATIONS[0]!],
      repeats: 1,
      strict: true,
      fault: "after-mutation",
    });
    expect(r.results[0]!.diff).toContain("current -= 0");
    expect(r.results[0]!.status).toBe("SETUP_ERROR");
    expect(r.results[0]!.cleanup.passed).toBe(true);
    expect(r.results[0]!.reason).toContain("Injected failure");
  }, 420000);
  it("aborts an owned child process and removes its disposable worktree", async () => {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 500);
    try {
      const r = await runMutationMatrix({
        root,
        mutations: [MUTATIONS[0]!],
        repeats: 1,
        strict: true,
        signal: c.signal,
      });
      expect(r.results[0]!.status).toBe("SETUP_ERROR");
      expect(r.results[0]!.cleanup.passed).toBe(true);
      expect(r.detectionGatePassed).toBe(false);
    } finally {
      clearTimeout(timer);
    }
  }, 420000);
});
