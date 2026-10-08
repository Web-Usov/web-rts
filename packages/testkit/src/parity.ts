import { projectGameStateView, toGameEvent, toSimulationCommand } from "@web-rts/match-adapter";
import {
  MAX_COMMAND_ID_LENGTH,
  MAX_MOVE_ENTITY_IDS,
  parseGameCommand,
  readRejectedCommandId,
  type GameStateView,
} from "@web-rts/protocol";
import {
  createMatchRuntime,
  type CommandAdmission,
  type MatchRuntime,
  type MatchSetup,
  type MatchStatus,
} from "@web-rts/simulation";

/** One client payload sent while the shell reports `tick === atTick`, before the next step. */
export interface ParityCommandStep {
  atTick: number;
  /** Raw client payload. Malformed payloads are allowed to exercise shell schema checks. */
  payload: unknown;
}

export interface ParityRejection {
  commandId: string;
  reason: string;
}

export interface MatchParityFixture {
  seed: number;
  mapId: string;
  /** Single participant: Local has exactly one player, Remote uses one client. */
  localPlayerId: number;
  ticks: number;
  steps: readonly ParityCommandStep[];
  expectedRejections: readonly ParityRejection[];
}

/**
 * Same setup + command sequence + tick count for Local and Remote shells.
 * Entity ids follow the shared bootstrap: unit 1 for player 0, objective 2.
 */
export const FOUNDATION_PARITY_FIXTURE: MatchParityFixture = {
  seed: 21,
  mapId: "foundation",
  localPlayerId: 0,
  ticks: 12,
  steps: [
    {
      atTick: 0,
      payload: {
        type: "MOVE",
        commandId: "move-a",
        clientSequence: 1,
        entityIds: [1],
        target: { x: 4, y: -3 },
      },
    },
    {
      atTick: 2,
      payload: {
        type: "MOVE",
        commandId: "oob",
        clientSequence: 2,
        entityIds: [1],
        target: { x: 50, y: 0 },
      },
    },
    {
      atTick: 2,
      payload: {
        type: "MOVE",
        commandId: "objective",
        clientSequence: 3,
        entityIds: [2],
        target: { x: 1, y: 1 },
      },
    },
    { atTick: 3, payload: { type: "MOVE", commandId: "malformed" } },
    {
      atTick: 3,
      payload: {
        type: "MOVE",
        commandId: "x".repeat(MAX_COMMAND_ID_LENGTH + 1),
        clientSequence: 4,
        entityIds: [1],
        target: { x: 1, y: 1 },
      },
    },
    {
      atTick: 3,
      payload: {
        type: "MOVE",
        commandId: "too-many-ids",
        clientSequence: 4,
        entityIds: Array.from({ length: MAX_MOVE_ENTITY_IDS + 1 }, () => 1),
        target: { x: 1, y: 1 },
      },
    },
    {
      atTick: 3,
      payload: {
        type: "MOVE",
        commandId: "foreign",
        clientSequence: 4,
        entityIds: [999],
        target: { x: 1, y: 1 },
      },
    },
    {
      atTick: 5,
      payload: {
        type: "MOVE",
        commandId: "move-b",
        clientSequence: 5,
        entityIds: [1],
        target: { x: -2, y: 5 },
      },
    },
  ],
  expectedRejections: [
    { commandId: "oob", reason: "out_of_bounds" },
    { commandId: "objective", reason: "not_your_unit" },
    { commandId: "malformed", reason: "invalid_schema" },
    { commandId: "unknown", reason: "invalid_schema" },
    { commandId: "too-many-ids", reason: "invalid_schema" },
    { commandId: "foreign", reason: "not_your_unit" },
  ],
};

/** G4b: 20 syntactically valid commands admitted together, only 16 processed. */
export const SCHEDULING_PARITY_FIXTURE: MatchParityFixture = {
  seed: 21,
  mapId: "foundation",
  localPlayerId: 0,
  ticks: 1,
  steps: Array.from({ length: 20 }, (_, index) => ({
    atTick: 0,
    payload: {
      type: "MOVE",
      commandId: `budget-${index}`,
      clientSequence: index + 1,
      entityIds: [999],
      target: { x: 0, y: 0 },
    },
  })),
  expectedRejections: Array.from({ length: 16 }, (_, index) => ({
    commandId: `budget-${index}`,
    reason: "not_your_unit",
  })),
};

export type NormalizedGameStateView = Omit<GameStateView, "roomId" | "players">;

/** Drops shell/transport metadata so Local and Remote gameplay views compare directly. */
export function normalizeGameStateView(view: GameStateView): NormalizedGameStateView {
  return {
    protocolVersion: view.protocolVersion,
    gameDataVersion: view.gameDataVersion,
    tick: view.tick,
    phase: view.phase,
    localPlayerId: view.localPlayerId,
    entities: [...view.entities].sort((left, right) => left.entityId - right.entityId),
  };
}

export interface ParityOutcome {
  finalView: NormalizedGameStateView;
  rejections: ParityRejection[];
}

/**
 * Shell-free reference run of a fixture: schema parse → shared mapper → runtime →
 * shared projector. Local and Remote shells must both match this outcome.
 */
export function runParityReference(fixture: MatchParityFixture): ParityOutcome {
  const runtime = createMatchRuntime({
    seed: fixture.seed,
    mapId: fixture.mapId,
    participants: [{ playerId: fixture.localPlayerId }],
  });
  const rejections: ParityRejection[] = [];
  const actor = { playerId: fixture.localPlayerId };
  for (let tick = 0; tick < fixture.ticks; tick += 1) {
    for (const step of fixture.steps) {
      if (step.atTick !== tick) {
        continue;
      }
      const parsed = parseGameCommand(step.payload);
      if (!parsed.success) {
        rejections.push({
          commandId: readRejectedCommandId(step.payload),
          reason: "invalid_schema",
        });
        continue;
      }
      const admission = runtime.submitCommand(actor, toSimulationCommand(parsed.data));
      if (!admission.accepted) {
        rejections.push({ commandId: parsed.data.commandId, reason: admission.reason });
      }
    }
    runtime.step();
    for (const event of runtime.drainEvents()) {
      const wire = toGameEvent(event);
      rejections.push({ commandId: wire.commandId, reason: wire.reason });
    }
  }
  const view = projectGameStateView(
    runtime.readSnapshot(),
    { localPlayerId: fixture.localPlayerId },
    { roomId: "reference", phase: "RUNNING", players: [] },
  );
  return { finalView: normalizeGameStateView(view), rejections };
}

/** Steps after which {@link createFinishingMatchRuntime} reports FINISHED. */
export const PARITY_FINISH_AFTER_STEPS = 3;

/**
 * Real MatchRuntime that reports FINISHED after `finishAfterSteps` steps.
 * Foundation gameplay has no terminal condition before G10; shells are tested
 * against this substitute so START → RUNNING → FINISHED stays observable.
 */
export function createFinishingMatchRuntime(
  setup: MatchSetup,
  finishAfterSteps: number = PARITY_FINISH_AFTER_STEPS,
): MatchRuntime {
  const inner = createMatchRuntime(setup);
  let steps = 0;
  const status = (): MatchStatus => (steps >= finishAfterSteps ? "FINISHED" : inner.status);
  return {
    get status() {
      return status();
    },
    submitCommand(actor, command): CommandAdmission {
      if (status() !== "RUNNING") {
        return { accepted: false, reason: "not_running" };
      }
      return inner.submitCommand(actor, command);
    },
    step() {
      if (status() !== "RUNNING") {
        return;
      }
      inner.step();
      steps += 1;
    },
    drainEvents: () => inner.drainEvents(),
    readSnapshot: () => ({ ...inner.readSnapshot(), status: status() }),
    readMetrics: () => inner.readMetrics(),
    removePlayer: (playerId) => {
      inner.removePlayer(playerId);
    },
  };
}
