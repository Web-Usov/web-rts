import {
  createMatchRuntime,
  type MatchEntitySnapshot,
  type MatchRuntime,
} from "@web-rts/simulation";
import type { EvidenceValue, GameplayCheck, GameplayScenario } from "./verification.js";

export const SCENARIO_LIMITS = {
  bytes: 65536,
  ticks: 1000,
  operations: 256,
  checks: 128,
  outputBytes: 262144,
  events: 512,
} as const;
type Selector = { definitionId: string; ownerPlayerId: number | null; index: number };
type Query =
  | { type: "entity"; entity: string; fields: string[] }
  | { type: "metric"; field: string }
  | { type: "events"; filter: Record<string, EvidenceValue> }
  | { type: "admission"; commandId: string };
type Operation =
  | {
      tick: number;
      type: "move";
      playerId: number;
      commandId: string;
      entity: string;
      target: { x: number; y: number };
    }
  | { tick: number; type: "removePlayer"; playerId: number }
  | {
      tick: number;
      type: "check";
      id: string;
      query: Query;
      expected: EvidenceValue;
      initial: boolean;
    };
export interface ScenarioDefinition {
  version: 1;
  id: string;
  seed: number;
  ticks: number;
  setup: { fixture: "match" | "combat"; players: number[] };
  selectors: Record<string, Selector>;
  operations: Operation[];
}
export interface FixtureDriver {
  entities(): readonly MatchEntitySnapshot[];
  step(): void;
  drainEvents(): unknown[];
  move(
    playerId: number,
    commandId: string,
    entityId: number,
    target: { x: number; y: number },
  ): unknown;
  metrics(): unknown;
  removePlayer?(playerId: number): void;
}
const entityFields = [
  "entityId",
  "kind",
  "definitionId",
  "x",
  "y",
  "ownerPlayerId",
  "controllerPlayerId",
  "soldierState",
  "health",
  "teamId",
];
/** x/y are WORLD-only projections of the discriminated snapshot location. */
function entityField(entity: unknown, field: string): unknown {
  const record = entity as Record<string, unknown> & {
    location?: { type: string; x?: number; y?: number };
  };
  if (field === "x" || field === "y")
    return record.location?.type === "WORLD" ? (record.location[field] ?? null) : null;
  return record[field] ?? null;
}
const metricFields = [
  "tick",
  "entityCount",
  "pendingCommandCount",
  "processedCommands",
  "reservedCommandPathCost",
  "commandBudgetUsed",
  "commandBudgetRemaining",
  "activeTaskQueries",
  "aiQueries",
];
function fail(message: string): never {
  throw new Error(`Invalid scenario: ${message}`);
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in result))
  )
    fail(`expected keys ${keys.join(",")}`);
  return result;
}
function integer(value: unknown, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
    fail("integer bounds");
}
function name(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) fail("unsafe identifier");
}
function strings(value: unknown, allowed: string[]): void {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 16 ||
    new Set(value).size !== value.length ||
    value.some((item) => !allowed.includes(item))
  )
    fail("unknown/empty fields");
}
function validateData(value: unknown, depth = 0): void {
  if (depth > 32) fail("nesting cap");
  if (typeof value === "number" && !Number.isFinite(value)) fail("non-finite value");
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  )
    fail("JSON data required");
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) validateData(item, depth + 1);
  }
}
export function parseScenarioDefinition(text: string): ScenarioDefinition {
  if (new TextEncoder().encode(text).length > SCENARIO_LIMITS.bytes) fail("input size cap");
  const raw: unknown = JSON.parse(text);
  validateData(raw);
  const d = object(raw, ["version", "id", "seed", "ticks", "setup", "selectors", "operations"]);
  if (d.version !== 1) fail("version");
  name(d.id);
  integer(d.seed, 0xffffffff);
  integer(d.ticks, SCENARIO_LIMITS.ticks);
  const setup = object(d.setup, ["fixture", "players"]);
  if (!["match", "combat"].includes(String(setup.fixture))) fail("unknown fixture");
  if (
    !Array.isArray(setup.players) ||
    !setup.players.length ||
    setup.players.length > 4 ||
    new Set(setup.players).size !== setup.players.length
  )
    fail("players");
  setup.players.forEach((p) => integer(p, 3));
  if (setup.fixture === "combat" && JSON.stringify(setup.players) !== "[0]") fail("combat players");
  if (!d.selectors || typeof d.selectors !== "object" || Array.isArray(d.selectors))
    fail("selectors");
  const selectors = d.selectors as Record<string, unknown>;
  if (!Object.keys(selectors).length || Object.keys(selectors).length > 16) fail("selector cap");
  for (const [alias, value] of Object.entries(selectors)) {
    name(alias);
    const s = object(value, ["definitionId", "ownerPlayerId", "index"]);
    if (typeof s.definitionId !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(s.definitionId))
      fail("definitionId");
    if (s.ownerPlayerId !== null) integer(s.ownerPlayerId, 3);
    integer(s.index, 15);
  }
  if (!Array.isArray(d.operations) || d.operations.length > SCENARIO_LIMITS.operations)
    fail("operations cap");
  const ids = new Set<string>();
  const commands = new Set<string>();
  let tick = 0;
  for (const value of d.operations) {
    if (!value || typeof value !== "object") fail("operation");
    const type = (value as Record<string, unknown>).type;
    const op = object(
      value,
      type === "move"
        ? ["tick", "type", "playerId", "commandId", "entity", "target"]
        : type === "removePlayer"
          ? ["tick", "type", "playerId"]
          : type === "check"
            ? ["tick", "type", "id", "query", "expected", "initial"]
            : fail("unknown action"),
    );
    integer(op.tick, d.ticks);
    if (op.tick < tick) fail("ordered ticks");
    tick = op.tick;
    if (type !== "check") {
      integer(op.playerId, 3);
      if (setup.fixture !== "match" && type === "removePlayer") fail("unsupported lifecycle");
      if (type === "move") {
        name(op.commandId);
        if (commands.has(op.commandId)) fail("duplicate command id");
        commands.add(op.commandId);
        if (typeof op.entity !== "string" || !Object.hasOwn(selectors, op.entity))
          fail("unknown selector");
        const target = object(op.target, ["x", "y"]);
        if (
          [target.x, target.y].some(
            (n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 10000,
          )
        )
          fail("target bounds");
      }
    } else {
      name(op.id);
      if (ids.has(op.id)) fail("duplicate assertion id");
      ids.add(op.id);
      if (typeof op.initial !== "boolean") fail("initial flag");
      const qtype = (op.query as Record<string, unknown> | null)?.type;
      const q = object(
        op.query,
        qtype === "entity"
          ? ["type", "entity", "fields"]
          : qtype === "metric"
            ? ["type", "field"]
            : qtype === "events"
              ? ["type", "filter"]
              : qtype === "admission"
                ? ["type", "commandId"]
                : fail("unknown query"),
      );
      if (qtype === "entity") {
        if (typeof q.entity !== "string" || !Object.hasOwn(selectors, q.entity))
          fail("unknown selector");
        strings(q.fields, entityFields);
      } else if (qtype === "metric") {
        if (!metricFields.includes(String(q.field))) fail("unknown metric");
      } else if (qtype === "admission") {
        if (!commands.has(String(q.commandId))) fail("unknown admission");
      } else {
        if (
          !q.filter ||
          typeof q.filter !== "object" ||
          Array.isArray(q.filter) ||
          Object.keys(q.filter).some(
            (k) => !["type", "commandId", "reason", "recipientPlayerId", "tick"].includes(k),
          )
        )
          fail("event filter");
      }
      if (op.initial && (qtype !== "entity" || op.expected !== null))
        fail("initial requires entity query and null placeholder");
    }
  }
  if (!ids.size || ids.size > SCENARIO_LIMITS.checks) fail("empty checks/check cap");
  return raw as ScenarioDefinition;
}
function json(value: unknown): EvidenceValue {
  return JSON.parse(JSON.stringify(value)) as EvidenceValue;
}
export function matchFixture(d: ScenarioDefinition): FixtureDriver {
  const runtime: MatchRuntime = createMatchRuntime({
    seed: d.seed,
    mapId: "foundation",
    participants: d.setup.players.map((playerId) => ({ playerId })),
  });
  return {
    entities: () => runtime.readSnapshot().entities,
    step: () => runtime.step(),
    drainEvents: () => runtime.drainEvents(),
    metrics: () => runtime.readMetrics(),
    move: (playerId, commandId, entityId, target) =>
      runtime.submitCommand(
        { playerId },
        { type: "MOVE", commandId, entityIds: [entityId], target },
      ),
    removePlayer: (playerId) => runtime.removePlayer(playerId),
  };
}
/** Actions/checkpoints run in listed order at tick N, before step N→N+1. */
export function definedScenario(
  definition: ScenarioDefinition,
  fixture: (d: ScenarioDefinition) => FixtureDriver,
): GameplayScenario {
  // Revalidate even typed callers; there is no unchecked execution path.
  validateData(definition);
  const d = parseScenarioDefinition(JSON.stringify(definition));
  return {
    scenarioId: d.id,
    seed: d.seed,
    ticks: d.ticks,
    inputs: json(d),
    execute: () => {
      const driver = fixture(d);
      const initial = json(driver.entities()) as unknown as MatchEntitySnapshot[];
      const aliases = new Map<string, number>();
      for (const [alias, selector] of Object.entries(d.selectors)) {
        const entity = initial.filter(
          (e) =>
            e.definitionId === selector.definitionId && e.ownerPlayerId === selector.ownerPlayerId,
        )[selector.index];
        if (!entity) throw new Error(`Selector ${alias} did not resolve`);
        aliases.set(alias, entity.entityId);
      }
      const events: EvidenceValue[] = [];
      const admissions = new Map<string, EvidenceValue>();
      const checks: GameplayCheck[] = [];
      const trace: EvidenceValue[] = [];
      function observe(q: Query, entities = driver.entities()): EvidenceValue {
        if (q.type === "events")
          return events.filter((e) =>
            Object.entries(q.filter).every(
              ([key, value]) =>
                JSON.stringify((e as Record<string, EvidenceValue>)[key]) === JSON.stringify(value),
            ),
          );
        if (q.type === "admission") return admissions.get(q.commandId) ?? null;
        if (q.type === "metric")
          return json((driver.metrics() as Record<string, unknown>)[q.field]);
        const entity = entities.find((e) => e.entityId === aliases.get(q.entity));
        return entity
          ? Object.fromEntries(q.fields.map((field) => [field, json(entityField(entity, field))]))
          : null;
      }
      let cursor = 0;
      for (let tick = 0; tick <= d.ticks; tick++) {
        while (d.operations[cursor]?.tick === tick) {
          const op = d.operations[cursor++]!;
          if (op.type === "move") {
            const admission = json(
              driver.move(op.playerId, op.commandId, aliases.get(op.entity)!, op.target),
            );
            admissions.set(op.commandId, admission);
            trace.push(json({ tick, action: op.type, commandId: op.commandId, admission }));
          } else if (op.type === "removePlayer") {
            if (!driver.removePlayer) throw new Error("Fixture does not support lifecycle");
            driver.removePlayer(op.playerId);
            trace.push(json({ tick, action: op.type, playerId: op.playerId }));
          } else {
            const check = {
              id: op.id,
              tick,
              expected: op.initial ? observe(op.query, initial) : op.expected,
              actual: observe(op.query),
            };
            checks.push(check);
            trace.push(json(check));
          }
        }
        if (tick < d.ticks) {
          driver.step();
          const batch = json(driver.drainEvents()) as EvidenceValue[];
          events.push(...batch);
          if (events.length > SCENARIO_LIMITS.events) throw new Error("Event cap exceeded");
          if (batch.length) trace.push({ observedTick: tick + 1, events: batch });
        }
      }
      const result = { checks, observations: { trace, events } };
      if (new TextEncoder().encode(JSON.stringify(result)).length > SCENARIO_LIMITS.outputBytes)
        throw new Error("Trace/output cap exceeded");
      return result;
    },
  };
}
