import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  type ProtocolCompatibility,
} from "@web-rts/protocol";
import { DEFAULT_MAP_ID } from "./constants.js";

/**
 * Client create/join options. Version fields are mandatory for handshake.
 * `seed` / `mapId` are applied on room create (first joiner / createRoom options).
 */
export type RoomJoinOptions = {
  protocolVersion: number;
  gameDataVersion: string;
  seed: number;
  mapId: string;
};

export type JoinOptionsParseResult =
  | { success: true; data: RoomJoinOptions; compatibility: ProtocolCompatibility }
  | { success: false; reason: string; compatibility?: ProtocolCompatibility };

/**
 * Runtime-parses join/create options without throwing.
 * Does not trust any player identity fields from the client payload.
 */
export function parseRoomJoinOptions(input: unknown): JoinOptionsParseResult {
  if (input === null || typeof input !== "object") {
    return { success: false, reason: "invalid_join_options" };
  }

  const raw = input as Record<string, unknown>;
  const protocolVersion = raw["protocolVersion"];
  const gameDataVersion = raw["gameDataVersion"];

  if (typeof protocolVersion !== "number" || !Number.isFinite(protocolVersion)) {
    return { success: false, reason: "missing_protocol_version" };
  }
  if (typeof gameDataVersion !== "string" || gameDataVersion.length === 0) {
    return { success: false, reason: "missing_game_data_version" };
  }

  const compatibility = checkProtocolCompatibility({
    protocolVersion,
    gameDataVersion,
    expectedProtocolVersion: PROTOCOL_VERSION,
    expectedGameDataVersion: GAME_DATA_VERSION,
  });

  if (!compatibility.compatible) {
    return { success: false, reason: "protocol_mismatch", compatibility };
  }

  const seedRaw = raw["seed"];
  const seed = typeof seedRaw === "number" && Number.isFinite(seedRaw) ? Math.trunc(seedRaw) : 0;

  const mapIdRaw = raw["mapId"];
  const mapId = typeof mapIdRaw === "string" && mapIdRaw.length > 0 ? mapIdRaw : DEFAULT_MAP_ID;

  return {
    success: true,
    data: {
      protocolVersion,
      gameDataVersion,
      seed,
      mapId,
    },
    compatibility,
  };
}
