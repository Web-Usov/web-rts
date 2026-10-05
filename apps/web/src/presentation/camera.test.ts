import { describe, expect, it } from "vitest";
import {
  RTS_CAMERA_ALPHA,
  RTS_CAMERA_MAX_RADIUS,
  RTS_CAMERA_MIN_RADIUS,
  createRtsCameraPose,
  panRtsCamera,
  screenDragToGround,
  zoomRtsCamera,
} from "./camera.js";
import { PRESENTED_MAP, mapGroundExtent } from "./map-layout.js";

const extent = mapGroundExtent(PRESENTED_MAP);

describe("RTS camera", () => {
  it("pans the target and clamps it to the MapDefinition extent", () => {
    const pose = createRtsCameraPose(extent);
    const moved = panRtsCamera(pose, 4, -2, extent);

    expect(pose).toMatchObject({ targetX: 0, targetZ: 0 });
    expect(moved).toEqual({ targetX: 4, targetZ: -2, radius: pose.radius });
    expect(panRtsCamera(pose, 100, -100, extent)).toEqual({
      targetX: 20,
      targetZ: -20,
      radius: pose.radius,
    });
  });

  it("derives the camera extent from the map, not a presentation constant", () => {
    const offsetMap = { ...PRESENTED_MAP, originX: 0, originY: 10, widthCells: 8, heightCells: 4 };
    const offsetExtent = mapGroundExtent(offsetMap);

    expect(offsetExtent).toEqual({ minX: 0, maxX: 8, minZ: 10, maxZ: 14 });
    expect(createRtsCameraPose(offsetExtent)).toMatchObject({ targetX: 4, targetZ: 12 });
    expect(panRtsCamera(createRtsCameraPose(offsetExtent), -50, 50, offsetExtent)).toMatchObject({
      targetX: 0,
      targetZ: 14,
    });
  });

  it("zooms by changing radius inside fixed limits", () => {
    const pose = createRtsCameraPose(extent);

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
