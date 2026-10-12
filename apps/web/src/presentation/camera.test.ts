import { describe, expect, it } from "vitest";
import {
  anchoredZoom,
  boundCamera,
  groundAtScreen,
  normalizedAxis,
  edgeAxis,
  wheelPixels,
  smoothingFactor,
  RtsCameraController,
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
    expect(moved).toEqual({ targetX: 4, targetZ: -2, alpha: pose.alpha, radius: pose.radius });
    expect(panRtsCamera(pose, 100, -100, extent)).toEqual({
      targetX: 20,
      targetZ: -20,
      alpha: pose.alpha,
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
      alpha: pose.alpha,
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

describe("C1 camera math and motion", () => {
  const view = { width: 1280, height: 720, fov: 0.8 };
  const large = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  it("keeps cursor ground invariant through zoom at all four yaws", () => {
    for (let turn = 0; turn < 4; turn++) {
      const pose = {
        ...createRtsCameraPose(large),
        alpha: RTS_CAMERA_ALPHA + (turn * Math.PI) / 2,
      };
      const point = { x: 900, y: 450 };
      const ground = groundAtScreen(pose, point, view);
      const zoomed = anchoredZoom(pose, 12, point, view);
      expect(groundAtScreen(zoomed, point, view).x).toBeCloseTo(ground.x, 10);
      expect(groundAtScreen(zoomed, point, view).z).toBeCloseTo(ground.z, 10);
    }
  });
  it("constrains every viewport corner when full containment is feasible", () => {
    for (const radius of [12, 28, 48])
      for (let turn = 0; turn < 4; turn++) {
        const pose = boundCamera(
          {
            ...createRtsCameraPose(large),
            radius,
            alpha: RTS_CAMERA_ALPHA + (turn * Math.PI) / 2,
            targetX: 2000,
            targetZ: -2000,
          },
          large,
          view,
        );
        for (const point of [
          { x: 0, y: 0 },
          { x: 1280, y: 0 },
          { x: 0, y: 720 },
          { x: 1280, y: 720 },
        ]) {
          const ground = groundAtScreen(pose, point, view);
          expect(ground.x).toBeGreaterThanOrEqual(-1000 - 1e-9);
          expect(ground.x).toBeLessThanOrEqual(1000 + 1e-9);
          expect(ground.z).toBeGreaterThanOrEqual(-1000 - 1e-9);
          expect(ground.z).toBeLessThanOrEqual(1000 + 1e-9);
        }
      }
  });
  it("handles undersized and zero-size extents without invalid limits", () => {
    for (const size of [0, 0.01, 4, 40]) {
      const bounds = { minX: 0, maxX: size, minZ: 10, maxZ: 10 + size };
      const pose = boundCamera(
        { ...createRtsCameraPose(bounds), targetX: 999, targetZ: -999 },
        bounds,
        view,
      );
      expect(Number.isFinite(pose.targetX + pose.targetZ)).toBe(true);
      expect(pose.targetX).toBeGreaterThanOrEqual(0);
      expect(pose.targetX).toBeLessThanOrEqual(size);
      expect(pose.targetZ).toBeGreaterThanOrEqual(10);
    }
  });
  it("pan, wheel smoothing and quarter-turns are independent of frame rate", () => {
    const run = (fps: number) => {
      const camera = new RtsCameraController(large);
      camera.rotate(1);
      camera.wheel(-100, { x: 640, y: 360 });
      for (let i = 0; i < fps; i++) camera.step(1 / fps, { x: 1, y: 0 }, 0, false, view);
      return camera.pose;
    };
    // Pan speed changes during animated yaw/zoom; integration error stays bounded.
    const a = run(30),
      b = run(144);
    expect(a.radius).toBeCloseTo(b.radius, 10);
    expect(a.alpha).toBe(b.alpha);
    expect(Math.hypot(a.targetX - b.targetX, a.targetZ - b.targetZ)).toBeLessThan(0.3);
    expect(smoothingFactor(1 / 30)).toBeGreaterThan(smoothingFactor(1 / 144));
  });
  it("four turns return exactly home yaw and Home resets in-flight animation", () => {
    const camera = new RtsCameraController(large);
    for (let i = 0; i < 400; i++) {
      camera.rotate(-1);
      camera.step(0.25, { x: 0, y: 0 }, 0, false, view);
    }
    expect(camera.pose.alpha).toBe(RTS_CAMERA_ALPHA);
    camera.rotate(1);
    camera.wheel(400, { x: 900, y: 500 });
    camera.home();
    expect(camera.step(1, { x: 0, y: 0 }, 0, false, view)).toEqual(createRtsCameraPose(large));
  });
  it("diagonal normalization, edge zones and wheel modes preserve magnitudes", () => {
    expect(Math.hypot(...Object.values(normalizedAxis(1, 1)))).toBeCloseTo(1);
    expect(edgeAxis({ x: 0, y: 0 }, view)).toEqual(normalizedAxis(-1, -1));
    expect(edgeAxis({ x: -1, y: 300 }, view)).toEqual({ x: 0, y: 0 });
    expect(wheelPixels(1, 1, 720)).toBe(16);
    expect(wheelPixels(1, 2, 720)).toBe(600);
    expect(wheelPixels(100000, 0, 720)).toBe(600);
  });
});

it("bounds are continuous when a map begins to fit the viewport", () => {
  const view = { width: 1280, height: 720, fov: 0.8 };
  const pose = { ...createRtsCameraPose(extent), alpha: 0 };
  const corners = [
    { x: 0, y: 0 },
    { x: 1280, y: 0 },
    { x: 0, y: 720 },
    { x: 1280, y: 720 },
  ].map((point) => groundAtScreen(pose, point, view));
  const size = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
  const before = boundCamera(
    pose,
    { minX: -size / 2 + 0.001, maxX: size / 2 - 0.001, minZ: -1000, maxZ: 1000 },
    view,
  );
  const after = boundCamera(
    pose,
    { minX: -size / 2 - 0.001, maxX: size / 2 + 0.001, minZ: -1000, maxZ: 1000 },
    view,
  );
  expect(Math.abs(before.targetX - after.targetX)).toBeLessThan(0.005);
});

it("ground grab is immediate and correct at all yaw orientations", () => {
  const bounds = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  const view = { width: 1280, height: 720, fov: 0.8 };
  for (let turn = 0; turn < 4; turn++) {
    const camera = new RtsCameraController(bounds);
    for (let index = 0; index < turn; index++) {
      camera.rotate(1);
      camera.step(0.25, { x: 0, y: 0 }, 0, false, view);
    }
    const from = { x: 800, y: 450 },
      to = { x: 950, y: 480 };
    const anchor = groundAtScreen(camera.pose, from, view);
    camera.drag(from, to, view);
    const after = groundAtScreen(camera.pose, to, view);
    expect(after.x).toBeCloseTo(anchor.x, 10);
    expect(after.z).toBeCloseTo(anchor.z, 10);
  }
});
