import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@web-rts/protocol", () => {
  it("exports package name placeholder", () => {
    expect(packageName).toBe("@web-rts/protocol");
  });
});
