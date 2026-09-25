import { describe, expect, it } from "vitest";
import {
  babylonToSimulationGround,
  simulationToBabylonGround,
  simulationToBabylonPosition,
} from "../presentation/coordinates.js";

describe("coordinate mapping (x,y) ↔ (x,z)", () => {
  it("maps simulation ground to Babylon ground and back", () => {
    const sim = { x: 3.5, y: -7 };
    const babylon = simulationToBabylonGround(sim);
    expect(babylon).toEqual({ x: 3.5, z: -7 });
    expect(babylonToSimulationGround(babylon)).toEqual(sim);
  });

  it("maps Babylon click ground to simulation MOVE target", () => {
    expect(babylonToSimulationGround({ x: 10, z: 4 })).toEqual({ x: 10, y: 4 });
  });

  it("places replicated entities on Babylon with presentation height only", () => {
    expect(simulationToBabylonPosition({ x: 1, y: 2 }, 0.6)).toEqual({
      x: 1,
      y: 0.6,
      z: 2,
    });
  });

  it("does not put Babylon z into the simulation axis name", () => {
    const target = babylonToSimulationGround({ x: 0, z: 9 });
    expect(Object.keys(target).sort()).toEqual(["x", "y"]);
    expect(target).not.toHaveProperty("z");
  });
});
