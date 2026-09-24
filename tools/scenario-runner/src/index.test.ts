import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@web-rts/scenario-runner", () => {
  it("exports package name placeholder", () => {
    expect(packageName).toBe("@web-rts/scenario-runner");
  });
});
