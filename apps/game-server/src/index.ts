/** Public entry for @web-rts/game-server. */
export const packageName = "@web-rts/game-server" as const;

export {
  AUTH_ERROR_CODE,
  COMMAND_MESSAGE,
  DEFAULT_MAP_ID,
  DEFAULT_PORT,
  EVENT_MESSAGE,
  FOUNDATION_ROOM_NAME,
  MAX_PLAYERS,
  ROOM_FULL_ERROR_CODE,
  START_MESSAGE,
} from "./constants.js";

export { createGameServer, type GameServer } from "./app-config.js";
export {
  mapGameCommandToSimulation,
  simulationCommandHasTransportFields,
  type SessionPlayerContext,
} from "./command-mapper.js";
export { parseRoomJoinOptions, type RoomJoinOptions } from "./join-options.js";
export { PlayerSlotRegistry, type PlayerSlot } from "./player-slots.js";
export { FoundationRoom } from "./rooms/foundation-room.js";
export { SimulationHost, type SimulationHostOptions } from "./simulation-host.js";
