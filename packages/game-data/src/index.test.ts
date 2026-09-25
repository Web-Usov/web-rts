import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@web-rts/game-data", () => {
  it("exports package name", () => {
    expect(packageName).toBe("@web-rts/game-data");
  });
});
