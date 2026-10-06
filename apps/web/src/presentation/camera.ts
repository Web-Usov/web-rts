import type { GroundExtent } from "./map-layout.js";

/** Fixed isometric yaw/pitch. Pan and zoom move the target and radius only. */
export const RTS_CAMERA_ALPHA = -Math.PI / 4;
export const RTS_CAMERA_BETA = Math.PI / 3;

export const RTS_CAMERA_MIN_RADIUS = 12;
export const RTS_CAMERA_MAX_RADIUS = 48;

export interface RtsCameraPose {
  readonly targetX: number;
  readonly targetZ: number;
  readonly radius: number;
}

/** Starts centered on the map. */
export function createRtsCameraPose(extent: GroundExtent): RtsCameraPose {
  return {
    targetX: (extent.minX + extent.maxX) / 2,
    targetZ: (extent.minZ + extent.maxZ) / 2,
    radius: 28,
  };
}

export function screenDragToGround(
  screenDx: number,
  screenDy: number,
  radius: number,
  alpha: number = RTS_CAMERA_ALPHA,
): { x: number; z: number } {
  const scale = (radius / 28) * 0.03;
  const cos = Math.cos(alpha);
  const sin = Math.sin(alpha);

  // ArcRotateCamera's horizontal screen-right basis on the ground plane is
  // (-sin(alpha), cos(alpha)); its screen-down/depth basis is
  // (cos(alpha), sin(alpha)). Keep mouse axes aligned to those bases instead
  // of accidentally swapping horizontal drag with camera depth.
  return {
    x: (-screenDx * sin + screenDy * cos) * scale,
    z: (screenDx * cos + screenDy * sin) * scale,
  };
}

export function panRtsCamera(
  pose: RtsCameraPose,
  deltaX: number,
  deltaZ: number,
  extent: GroundExtent,
): RtsCameraPose {
  return {
    targetX: clamp(pose.targetX + deltaX, extent.minX, extent.maxX),
    targetZ: clamp(pose.targetZ + deltaZ, extent.minZ, extent.maxZ),
    radius: pose.radius,
  };
}

export function zoomRtsCamera(
  pose: RtsCameraPose,
  deltaRadius: number,
  minRadius: number = RTS_CAMERA_MIN_RADIUS,
  maxRadius: number = RTS_CAMERA_MAX_RADIUS,
): RtsCameraPose {
  return {
    targetX: pose.targetX,
    targetZ: pose.targetZ,
    radius: clamp(pose.radius + deltaRadius, minRadius, maxRadius),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
