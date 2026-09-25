export {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  type GameDataVersion,
  type ProtocolCompatibility,
  type ProtocolVersion,
} from "./versions.js";

export {
  gameCommandSchema,
  moveCommandSchema,
  type GameCommand,
  type MoveCommand,
} from "./commands.js";

export {
  commandRejectedEventSchema,
  gameEventSchema,
  protocolMismatchEventSchema,
  type CommandRejectedEvent,
  type GameEvent,
  type ProtocolMismatchEvent,
} from "./events.js";

export {
  entityViewSchema,
  gameStateViewSchema,
  matchPhaseSchema,
  playerSlotViewSchema,
  type EntityView,
  type GameStateView,
  type MatchPhase,
  type PlayerSlotView,
} from "./state.js";

export type {
  ConnectOptions,
  EventListener,
  GameTransport,
  StateListener,
  Unsubscribe,
} from "./transport.js";

export {
  parseGameCommand,
  parseGameEvent,
  parseGameStateView,
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
