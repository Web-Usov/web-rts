export {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  type GameDataVersion,
  type ProtocolCompatibility,
  type ProtocolVersion,
} from "./versions.js";

export {
  commandIdSchema,
  gameCommandSchema,
  moveCommandSchema,
  type GameCommand,
  type MoveCommand,
} from "./commands.js";

export {
  COMMAND_ID_PATTERN,
  MAX_COMMAND_ID_LENGTH,
  MAX_ENTITY_ID,
  MAX_MOVE_ENTITY_IDS,
  MAX_WORLD_COORDINATE_ABS,
} from "./limits.js";

export {
  commandRejectedEventSchema,
  gameEventSchema,
  protocolMismatchEventSchema,
  type CommandRejectedEvent,
  type GameEvent,
  type ProtocolMismatchEvent,
} from "./events.js";

export {
  entityKindSchema,
  entityViewSchema,
  gameStateViewSchema,
  matchPhaseSchema,
  objectiveTypeSchema,
  playerSlotViewSchema,
  type EntityKindView,
  type EntityView,
  type GameStateView,
  type MatchPhase,
  type PlayerSlotView,
} from "./state.js";

export type {
  ConnectOptions,
  ConnectionListener,
  EventListener,
  GameTransport,
  ResumeSessionOptions,
  ResumeSessionResult,
  StateListener,
  TransportConnectionNotice,
  Unsubscribe,
} from "./transport.js";

export {
  parseGameCommand,
  parseGameEvent,
  parseGameStateView,
  readRejectedCommandId,
  UNKNOWN_COMMAND_ID,
  type ProtocolParseFailure,
  type ProtocolParseResult,
  type ProtocolParseSuccess,
} from "./parse.js";

export {
  COMMAND_MESSAGE,
  EVENT_MESSAGE,
  START_MESSAGE,
  STATE_MESSAGE,
  SYNC_MESSAGE,
} from "./messages.js";
