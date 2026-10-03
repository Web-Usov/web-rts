import { describe, expect, it } from "vitest";
import { isLocalTransportSearch } from "./transport-mode.js";

describe("transport mode", () => {
  it("selects local only for the transport query", () => {
    expect(isLocalTransportSearch("?transport=local")).toBe(true);
    expect(isLocalTransportSearch("?room=1&transport=local")).toBe(true);
    expect(isLocalTransportSearch("")).toBe(false);
    expect(isLocalTransportSearch("?transport=remote")).toBe(false);
    expect(isLocalTransportSearch("?transport=LOCAL")).toBe(false);
  });
});
