/**
 * Structured match logs. No logging framework.
 *
 * Foundation has one match lifecycle per Colyseus Room, so `matchId` is `roomId`.
 * That is a logging alias, not a new gameplay entity.
 * Records intentionally omit command payloads and state snapshots.
 */
export type MatchLogLevel = "info" | "warn" | "error";

export type MatchLogContext = {
  roomId: string;
  tick: number;
  playerId?: number;
  sessionId?: string;
};

export type MatchLogFields = {
  level: MatchLogLevel;
  event: string;
  durationMs?: number;
  entityCount?: number;
  pendingCommandCount?: number;
  reason?: string;
  commandId?: string;
  error?: string;
};

export type MatchLogRecord = {
  level: MatchLogLevel;
  event: string;
  roomId: string;
  matchId: string;
  tick: number;
  playerId?: number;
  sessionId?: string;
  durationMs?: number;
  entityCount?: number;
  pendingCommandCount?: number;
  reason?: string;
  commandId?: string;
  error?: string;
};

export function createMatchLogRecord(
  context: MatchLogContext,
  fields: MatchLogFields,
): MatchLogRecord {
  const record: MatchLogRecord = {
    level: fields.level,
    event: fields.event,
    roomId: context.roomId,
    matchId: context.roomId,
    tick: context.tick,
  };

  if (context.playerId !== undefined) {
    record.playerId = context.playerId;
  }
  if (context.sessionId !== undefined) {
    record.sessionId = context.sessionId;
  }
  if (fields.durationMs !== undefined) {
    record.durationMs = fields.durationMs;
  }
  if (fields.entityCount !== undefined) {
    record.entityCount = fields.entityCount;
  }
  if (fields.pendingCommandCount !== undefined) {
    record.pendingCommandCount = fields.pendingCommandCount;
  }
  if (fields.reason !== undefined) {
    record.reason = fields.reason;
  }
  if (fields.commandId !== undefined) {
    record.commandId = fields.commandId;
  }
  if (fields.error !== undefined) {
    record.error = fields.error;
  }

  return record;
}

export type MatchLogSink = (record: MatchLogRecord) => void;

const defaultSink: MatchLogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
};

export function writeMatchLog(record: MatchLogRecord, sink: MatchLogSink = defaultSink): void {
  sink(record);
}
