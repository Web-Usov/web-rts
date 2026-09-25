/**
 * Pure coordinate boundary between simulation/protocol ground (x, y)
 * and Babylon ground plane (x, z). Finding I2 / audit #25.
 *
 * Babylon's vertical axis (mesh height) is presentation-only and never enters
 * GameCommand / GameStateView / simulation contracts.
 */

export type SimulationGroundPoint = {
  readonly x: number;
  readonly y: number;
};

export type BabylonGroundPoint = {
  readonly x: number;
  readonly z: number;
};

export type BabylonWorldPosition = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** Protocol/simulation ground → Babylon ground plane (drops presentation height). */
export function simulationToBabylonGround(point: SimulationGroundPoint): BabylonGroundPoint {
  return { x: point.x, z: point.y };
}

/** Babylon ground pick → protocol/simulation MOVE target. */
export function babylonToSimulationGround(point: BabylonGroundPoint): SimulationGroundPoint {
  return { x: point.x, y: point.z };
}

/** Replicated entity (x, y) → Babylon mesh position with presentation height. */
export function simulationToBabylonPosition(
  point: SimulationGroundPoint,
  height: number,
): BabylonWorldPosition {
  const ground = simulationToBabylonGround(point);
  return { x: ground.x, y: height, z: ground.z };
}
