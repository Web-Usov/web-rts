import { describe, expect, it } from "vitest";
import { ownerColorSlot } from "./entity-color.js";

describe("ownerColorSlot", () => {
  it("uses the Owner slot regardless of Controller", () => {
    expect(ownerColorSlot("UNIT", 2)).toBe(2);
    expect(ownerColorSlot("BUILDING", 1)).toBe(1);
  });

  it("falls back to slot 0 for unowned entities and objectives", () => {
    expect(ownerColorSlot("UNIT", null)).toBe(0);
    expect(ownerColorSlot("RESOURCE", null)).toBe(0);
    expect(ownerColorSlot("OBJECTIVE", 3)).toBe(0);
  });
});
