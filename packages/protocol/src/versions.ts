/**
 * Wire protocol version. Bump on breaking command/event/state contract changes.
 * F6: EntityView gained required objectiveType/objectiveState.
 * Old strict parsers reject the new keys, so this bump is breaking.
 * @see docs/technical-vision.md §11
 */
export const PROTOCOL_VERSION = 3 as const;

/**
 * Declarative game-data / balance contract version exchanged at handshake.
 * Kept independent from PROTOCOL_VERSION so assets/rules can diverge from wire shape.
 * @see docs/technical-vision.md §11
 */
export const GAME_DATA_VERSION = "0.0.0" as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type GameDataVersion = typeof GAME_DATA_VERSION;

export type ProtocolCompatibility = {
  compatible: boolean;
  protocolMatch: boolean;
  gameDataMatch: boolean;
};

/**
 * Detects client/server version mismatch for connect handshake rejection.
 */
export function checkProtocolCompatibility(input: {
  protocolVersion: number;
  gameDataVersion: string;
  expectedProtocolVersion?: number;
  expectedGameDataVersion?: string;
}): ProtocolCompatibility {
  const expectedProtocolVersion = input.expectedProtocolVersion ?? PROTOCOL_VERSION;
  const expectedGameDataVersion = input.expectedGameDataVersion ?? GAME_DATA_VERSION;
  const protocolMatch = input.protocolVersion === expectedProtocolVersion;
  const gameDataMatch = input.gameDataVersion === expectedGameDataVersion;

  return {
    compatible: protocolMatch && gameDataMatch,
    protocolMatch,
    gameDataMatch,
  };
}
