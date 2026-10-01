import { describe, expect, it } from "vitest";
import { createMatchLogRecord, writeMatchLog } from "./match-log.js";

describe("match log records", () => {
  it("aliases matchId to roomId and keeps player and session context", () => {
    const record = createMatchLogRecord(
      { roomId: "room-1", tick: 4, playerId: 1, sessionId: "sess-1" },
      { level: "info", event: "player_joined" },
    );

    expect(record).toEqual({
      level: "info",
      event: "player_joined",
      roomId: "room-1",
      matchId: "room-1",
      tick: 4,
      playerId: 1,
      sessionId: "sess-1",
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it("logs a command rejection without a payload or state snapshot", () => {
    const record = createMatchLogRecord(
      { roomId: "room-9", tick: 12, playerId: 0, sessionId: "sess-0" },
      {
        level: "warn",
        event: "command_rejected",
        reason: "not_your_unit",
        commandId: "cmd-1",
      },
    );

    expect(record).not.toHaveProperty("payload");
    expect(record).not.toHaveProperty("state");
    expect(record.reason).toBe("not_your_unit");
    expect(record.commandId).toBe("cmd-1");
    expect(Object.keys(record).sort()).toEqual([
      "commandId",
      "event",
      "level",
      "matchId",
      "playerId",
      "reason",
      "roomId",
      "sessionId",
      "tick",
    ]);
  });

  it("writes one JSON line through the sink", () => {
    const lines: string[] = [];
    const record = createMatchLogRecord(
      { roomId: "room-2", tick: 3 },
      { level: "error", event: "internal_error", error: "boom" },
    );

    writeMatchLog(record, (written) => {
      lines.push(JSON.stringify(written));
    });

    expect(lines).toEqual([JSON.stringify(record)]);
    expect(record.error).toBe("boom");
    expect(record.matchId).toBe("room-2");
  });
});
