import { describe, expect, it } from "vitest";
import type { GameCommand, MoveCommand } from "@web-rts/protocol";
import {
  mapGameCommandToSimulation,
  simulationCommandHasTransportFields,
} from "./command-mapper.js";

const move: MoveCommand = {
  type: "MOVE",
  commandId: "cmd-1",
  clientSequence: 7,
  entityIds: [1, 2],
  target: { x: 3, y: 4 },
};

describe("mapGameCommandToSimulation", () => {
  it("maps MOVE and drops clientSequence (transport-only)", () => {
    const mapped = mapGameCommandToSimulation(move, {
      playerId: 0,
      sessionId: "sess-a",
    });

    expect(mapped).toEqual({
      type: "MOVE",
      commandId: "cmd-1",
      entityIds: [1, 2],
      target: { x: 3, y: 4 },
    });
    expect(simulationCommandHasTransportFields(mapped)).toBe(false);
    expect("clientSequence" in mapped).toBe(false);
    expect("playerId" in mapped).toBe(false);
  });

  it("does not embed session playerId into the simulation command", () => {
    const mapped = mapGameCommandToSimulation(move, {
      playerId: 99,
      sessionId: "sess-spoof-check",
    });
    expect(mapped).not.toHaveProperty("playerId");
  });

  it("copies entity ids so caller mutations do not alias protocol DTO arrays", () => {
    const command: GameCommand = {
      ...move,
      entityIds: [10],
    };
    const mapped = mapGameCommandToSimulation(command, {
      playerId: 1,
      sessionId: "s",
    });
    if (command.type === "MOVE") {
      command.entityIds.push(99);
    }
    expect(mapped.entityIds).toEqual([10]);
  });
});
