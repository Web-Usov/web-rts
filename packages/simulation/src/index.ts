export {
  DEFAULT_MOVE_SPEED,
  DEFAULT_TICK_HZ,
  resolveSimulationConfig,
  type CreateWorldOptions,
  type SimulationConfig,
} from "./config.js";
export type {
  CommandActor,
  CommandRejectionReason,
  QueuedCommand,
  SimulationCommand,
} from "./commands.js";
export type { SimulationEvent } from "./events.js";
export {
  DEFAULT_MAX_PENDING_COMMANDS_PER_PLAYER,
  createMatchRuntime,
  resolveRuntimeConfig,
  type RuntimeConfig,
  type CommandAdmission,
  type CommandAdmissionRejection,
  type MatchParticipant,
  type MatchRuntime,
  type MatchSetup,
  type MatchSnapshot,
  type MatchStatus,
  type RuntimeEvent,
  type RuntimeMetrics,
} from "./match-runtime.js";
export type { MatchEntitySnapshot } from "./snapshot.js";
export {
  OBJECTIVE_STATES,
  OBJECTIVE_TYPES,
  type Controller,
  type EntityId,
  type MapBounds,
  type Movement,
  type Objective,
  type ObjectiveState,
  type ObjectiveType,
  type Owner,
  type PlayerId,
  type Position,
  type Vec2,
} from "./types.js";
/** Low-level kernel for tests/testkit. Production shells use MatchRuntime. */
export { createWorld, World } from "./world.js";
