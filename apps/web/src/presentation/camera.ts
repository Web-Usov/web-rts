import type { GroundExtent } from "./map-layout.js";

export const RTS_CAMERA_ALPHA = -Math.PI / 4;
export const RTS_CAMERA_BETA = Math.PI / 3;
export const RTS_CAMERA_MIN_RADIUS = 12;
export const RTS_CAMERA_MAX_RADIUS = 48;

export interface RtsCameraPose {
  readonly targetX: number;
  readonly targetZ: number;
  readonly radius: number;
  readonly alpha: number;
}
export interface CameraViewport {
  width: number;
  height: number;
  fov: number;
}
export interface ScreenPoint {
  x: number;
  y: number;
}

export function createRtsCameraPose(extent: GroundExtent): RtsCameraPose {
  return {
    targetX: (extent.minX + extent.maxX) / 2,
    targetZ: (extent.minZ + extent.maxZ) / 2,
    radius: 28,
    alpha: RTS_CAMERA_ALPHA,
  };
}

/** Screen-right and screen-down ground bases for Babylon's left-handed orbit camera. */
export function screenDragToGround(
  screenDx: number,
  screenDy: number,
  radius: number,
  alpha = RTS_CAMERA_ALPHA,
): { x: number; z: number } {
  const scale = (radius / 28) * 0.03;
  return {
    x: (-screenDx * Math.sin(alpha) + screenDy * Math.cos(alpha)) * scale,
    z: (screenDx * Math.cos(alpha) + screenDy * Math.sin(alpha)) * scale,
  };
}
export function panRtsCamera(
  pose: RtsCameraPose,
  deltaX: number,
  deltaZ: number,
  extent: GroundExtent,
): RtsCameraPose {
  return {
    ...pose,
    targetX: clamp(pose.targetX + deltaX, extent.minX, extent.maxX),
    targetZ: clamp(pose.targetZ + deltaZ, extent.minZ, extent.maxZ),
  };
}
export function zoomRtsCamera(
  pose: RtsCameraPose,
  deltaRadius: number,
  minRadius = RTS_CAMERA_MIN_RADIUS,
  maxRadius = RTS_CAMERA_MAX_RADIUS,
): RtsCameraPose {
  return { ...pose, radius: clamp(pose.radius + deltaRadius, minRadius, maxRadius) };
}

/** Perspective ray/ground intersection; coordinates are CSS pixels relative to canvas. */
export function groundAtScreen(
  pose: RtsCameraPose,
  point: ScreenPoint,
  view: CameraViewport,
): { x: number; z: number } {
  const tan = Math.tan(view.fov / 2);
  const right = (((2 * point.x) / view.width - 1) * tan * view.width) / view.height;
  const up = (1 - (2 * point.y) / view.height) * tan;
  const sinB = Math.sin(RTS_CAMERA_BETA),
    cosB = Math.cos(RTS_CAMERA_BETA);
  const cos = Math.cos(pose.alpha),
    sin = Math.sin(pose.alpha);
  const distance = (pose.radius * cosB) / (cosB - up * sinB);
  return {
    x:
      pose.targetX +
      pose.radius * sinB * cos +
      distance * (-sinB * cos - right * sin - up * cosB * cos),
    z:
      pose.targetZ +
      pose.radius * sinB * sin +
      distance * (-sinB * sin + right * cos - up * cosB * sin),
  };
}

/** Constrain the ground footprint, falling back to centered overflow for a small map. */
export function boundCamera(
  pose: RtsCameraPose,
  extent: GroundExtent,
  view: CameraViewport,
): RtsCameraPose {
  const corners = [
    { x: 0, y: 0 },
    { x: view.width, y: 0 },
    { x: 0, y: view.height },
    { x: view.width, y: view.height },
  ].map((p) => groundAtScreen(pose, p, view));
  const xs = corners.map((p) => p.x - pose.targetX),
    zs = corners.map((p) => p.z - pose.targetZ);
  const axis = (value: number, min: number, max: number, offsets: number[]) => {
    const lo = min - Math.min(...offsets),
      hi = max - Math.max(...offsets);
    if (lo <= hi) return clamp(value, lo, hi);
    const size = max - min;
    if (size === 0) return min;
    // Full containment is impossible at strategic zoom. Keep a central pan
    // range, and blend it into the fitting interval as overflow approaches zero.
    // A hard fallback switch would jump at near-viewport-sized map extents.
    const t = clamp(1 - (lo - hi) / (size * 0.25), 0, 1);
    const blend = t * t * (3 - 2 * t);
    const center = clamp((lo + hi) / 2, min, max);
    const fallbackLo = min + size / 4,
      fallbackHi = max - size / 4;
    return clamp(
      value,
      fallbackLo + (center - fallbackLo) * blend,
      fallbackHi + (center - fallbackHi) * blend,
    );
  };
  return {
    ...pose,
    targetX: axis(pose.targetX, extent.minX, extent.maxX, xs),
    targetZ: axis(pose.targetZ, extent.minZ, extent.maxZ, zs),
  };
}
export function anchoredZoom(
  pose: RtsCameraPose,
  radius: number,
  point: ScreenPoint,
  view: CameraViewport,
): RtsCameraPose {
  const before = groundAtScreen(pose, point, view);
  const next = zoomRtsCamera(pose, radius - pose.radius);
  const after = groundAtScreen(next, point, view);
  return {
    ...next,
    targetX: next.targetX + before.x - after.x,
    targetZ: next.targetZ + before.z - after.z,
  };
}
export function normalizedAxis(x: number, y: number): ScreenPoint {
  const length = Math.max(1, Math.hypot(x, y));
  return { x: x / length, y: y / length };
}
export function wheelPixels(delta: number, mode: number, height: number): number {
  return clamp(delta * (mode === 1 ? 16 : mode === 2 ? height : 1), -600, 600);
}
export function edgeAxis(point: ScreenPoint, view: CameraViewport): ScreenPoint {
  if (point.x < 0 || point.y < 0 || point.x >= view.width || point.y >= view.height)
    return { x: 0, y: 0 };
  const edge = (value: number, size: number) =>
    value < 25 ? -(25 - value) / 25 : value > size - 25 ? (value - size + 25) / 25 : 0;
  return normalizedAxis(edge(point.x, view.width), edge(point.y, view.height));
}
export function smoothingFactor(dt: number, rate = 16): number {
  return -Math.expm1(-rate * dt);
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Small presentation-only state machine. No DOM, engine, or gameplay dependencies. */
export class RtsCameraController {
  pose: RtsCameraPose;
  private radiusGoal: number;
  private anchor: ScreenPoint | null = null;
  private turns = 0;
  private rotation: { from: number; to: number; elapsed: number } | null = null;
  constructor(private readonly extent: GroundExtent) {
    this.pose = createRtsCameraPose(extent);
    this.radiusGoal = this.pose.radius;
  }
  home(): void {
    this.pose = createRtsCameraPose(this.extent);
    this.radiusGoal = this.pose.radius;
    this.turns = 0;
    this.rotation = null;
    this.anchor = null;
  }
  rotate(direction: number): void {
    this.turns += direction;
    this.rotation = {
      from: this.pose.alpha,
      to: RTS_CAMERA_ALPHA + (this.turns * Math.PI) / 2,
      elapsed: 0,
    };
    this.anchor = null;
  }
  wheel(delta: number, point: ScreenPoint): void {
    this.radiusGoal = zoomRtsCamera(
      { ...this.pose, radius: this.radiusGoal },
      delta * 0.025,
    ).radius;
    this.anchor = point;
  }
  drag(from: ScreenPoint, to: ScreenPoint, view: CameraViewport): void {
    const a = groundAtScreen(this.pose, from, view),
      b = groundAtScreen(this.pose, to, view);
    this.pose = boundCamera(
      {
        ...this.pose,
        targetX: this.pose.targetX + a.x - b.x,
        targetZ: this.pose.targetZ + a.z - b.z,
      },
      this.extent,
      view,
    );
    this.anchor = null;
    this.radiusGoal = this.pose.radius;
  }
  step(
    dt: number,
    pan: ScreenPoint,
    zoom: number,
    fast: boolean,
    view: CameraViewport,
  ): RtsCameraPose {
    if (this.rotation) {
      this.rotation.elapsed = Math.min(0.25, this.rotation.elapsed + dt);
      const t = this.rotation.elapsed / 0.25;
      this.pose = {
        ...this.pose,
        alpha: this.rotation.from + (this.rotation.to - this.rotation.from) * (t * t * (3 - 2 * t)),
      };
      if (t === 1) {
        this.turns = ((this.turns % 4) + 4) % 4;
        this.pose = { ...this.pose, alpha: RTS_CAMERA_ALPHA + (this.turns * Math.PI) / 2 };
        this.rotation = null;
      }
    }
    if (zoom !== 0) {
      this.anchor = null;
      this.radiusGoal = zoomRtsCamera(
        this.pose,
        this.pose.radius * Math.expm1(zoom * 0.8 * dt),
      ).radius;
      this.pose = { ...this.pose, radius: this.radiusGoal };
    } else {
      const radius = this.pose.radius + (this.radiusGoal - this.pose.radius) * smoothingFactor(dt);
      this.pose = this.anchor
        ? anchoredZoom(this.pose, radius, this.anchor, view)
        : { ...this.pose, radius };
      if (Math.abs(radius - this.radiusGoal) < 0.0001) this.anchor = null;
    }
    const axis = normalizedAxis(pan.x, pan.y);
    const offset = screenDragToGround(axis.x, axis.y, this.pose.radius, this.pose.alpha);
    const speed = 420 * (fast ? 2.5 : 1) * dt;
    this.pose = boundCamera(
      {
        ...this.pose,
        targetX: this.pose.targetX + offset.x * speed,
        targetZ: this.pose.targetZ + offset.z * speed,
      },
      this.extent,
      view,
    );
    return this.pose;
  }
}
