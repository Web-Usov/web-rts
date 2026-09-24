import { describe, expect, it } from "vitest";
import {
  RTS_CAMERA_ALPHA,
  RTS_CAMERA_MAX_RADIUS,
  RTS_CAMERA_MIN_RADIUS,
  RTS_MAP_HALF_EXTENT,
  createRtsCameraPose,
  panRtsCamera,
  screenDragToGround,
  zoomRtsCamera,
} from "./camera.js";

describe("RTS camera", () => {
  it("pans the target and clamps it to the map", () => {
    const pose = createRtsCameraPose();
    const moved = panRtsCamera(pose, 4, -2);

    expect(moved).toEqual({ targetX: 4, targetZ: -2, radius: pose.radius });
    expect(panRtsCamera(pose, 100, -100)).toEqual({
      targetX: RTS_MAP_HALF_EXTENT,
      targetZ: -RTS_MAP_HALF_EXTENT,
      radius: pose.radius,
    });
  });

  it("zooms by changing radius inside fixed limits", () => {
    const pose = createRtsCameraPose();

    expect(zoomRtsCamera(pose, -100).radius).toBe(RTS_CAMERA_MIN_RADIUS);
    expect(zoomRtsCamera(pose, 100).radius).toBe(RTS_CAMERA_MAX_RADIUS);
    expect(zoomRtsCamera(pose, 2)).toEqual({
      targetX: pose.targetX,
      targetZ: pose.targetZ,
      radius: pose.radius + 2,
    });
  });

  it("maps horizontal screen drag to the camera-right ground basis", () => {
    const offset = screenDragToGround(10, 0, 28, 0);

    expect(offset.x).toBeCloseTo(0, 10);
    expect(offset.z).toBeGreaterThan(0);
  });

  it("maps vertical screen drag to the camera-depth ground basis", () => {
    const offset = screenDragToGround(0, 10, 28, 0);

    expect(offset.x).toBeGreaterThan(0);
    expect(offset.z).toBeCloseTo(0, 10);
  });

  it("keeps horizontal and vertical drag bases perpendicular for the isometric angle", () => {
    const horizontal = screenDragToGround(10, 0, 28, RTS_CAMERA_ALPHA);
    const vertical = screenDragToGround(0, 10, 28, RTS_CAMERA_ALPHA);
    const dot = horizontal.x * vertical.x + horizontal.z * vertical.z;

    expect(dot).toBeCloseTo(0, 10);
  });
});
