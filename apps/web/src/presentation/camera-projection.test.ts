import { expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/Culling/ray.js";
import { groundAtScreen, RTS_CAMERA_BETA, createRtsCameraPose } from "./camera.js";

it("pure ground projection matches Babylon picking at every yaw and zoom", () => {
  const engine = new NullEngine({
    renderWidth: 1280,
    renderHeight: 720,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("camera", 0, RTS_CAMERA_BETA, 28, Vector3.Zero(), scene);
  for (let turn = 0; turn < 4; turn++)
    for (const radius of [12, 28, 48]) {
      const pose = {
        ...createRtsCameraPose({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }),
        radius,
        alpha: -Math.PI / 4 + (turn * Math.PI) / 2,
      };
      camera.alpha = pose.alpha;
      camera.radius = radius;
      camera.getViewMatrix(true);
      for (const point of [
        { x: 640, y: 360 },
        { x: 800, y: 500 },
        { x: 0, y: 0 },
      ]) {
        const ray = scene.createPickingRay(point.x, point.y, Matrix.Identity(), camera);
        const distance = -ray.origin.y / ray.direction.y;
        const expected = ray.origin.add(ray.direction.scale(distance));
        const actual = groundAtScreen(pose, point, { width: 1280, height: 720, fov: camera.fov });
        // Babylon matrices use Float32; distant corner rays amplify rounding.
        expect(actual.x).toBeCloseTo(expected.x, 2);
        expect(actual.z).toBeCloseTo(expected.z, 2);
      }
    }
  scene.dispose();
  engine.dispose();
});
