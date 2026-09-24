import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@web-rts/bot-client", () => {
  it("exports package name placeholder", () => {
    expect(packageName).toBe("@web-rts/bot-client");
  });
});
