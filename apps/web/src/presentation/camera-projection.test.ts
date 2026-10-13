import { expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/Culling/ray.js";
import { Viewport } from "@babylonjs/core/Maths/math.viewport.js";
import {
  groundAtScreen,
  RTS_CAMERA_BETA,
  createRtsCameraPose,
  RtsCameraController,
} from "./camera.js";

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

it("C2 smoothed interior anchor stays projected in CSS pixels at every yaw and render scale", () => {
  const view = { width: 1280, height: 720, fov: 0.8 };
  const point = { x: 850, y: 430 };
  for (const scale of [1, 2]) {
    const engine = new NullEngine({
      renderWidth: view.width * scale,
      renderHeight: view.height * scale,
      textureSize: 512,
      deterministicLockstep: false,
      lockstepMaxSteps: 4,
    });
    const scene = new Scene(engine);
    const camera = new ArcRotateCamera("camera", 0, RTS_CAMERA_BETA, 28, Vector3.Zero(), scene);
    const viewport = new Viewport(0, 0, view.width, view.height);
    for (let turn = 0; turn < 4; turn++) {
      const controller = new RtsCameraController({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 });
      for (let i = 0; i < turn; i++) {
        controller.rotate(1);
        controller.step(0.25, { x: 0, y: 0 }, 0, false, view);
      }
      const apply = () => {
        camera.alpha = controller.pose.alpha;
        camera.radius = controller.pose.radius;
        camera.target.set(controller.pose.targetX, 0, controller.pose.targetZ);
        camera.getViewMatrix(true);
        camera.getProjectionMatrix(true);
      };
      apply();
      const ray = scene.createPickingRay(
        point.x * scale,
        point.y * scale,
        Matrix.Identity(),
        camera,
      );
      expect(ray.direction.y).toBeLessThan(0);
      const anchor = ray.origin.add(ray.direction.scale(-ray.origin.y / ray.direction.y));
      for (const delta of [-600, -600, 600, 600, 600, -600, 600]) {
        controller.wheel(delta, point);
        for (let frame = 0; frame < 90; frame++) {
          controller.step(1 / 60, { x: 0, y: 0 }, 0, false, view);
          apply();
          const projected = Vector3.Project(
            anchor,
            Matrix.Identity(),
            camera.getViewMatrix().multiply(camera.getProjectionMatrix()),
            viewport,
          );
          expect(Math.hypot(projected.x - point.x, projected.y - point.y)).toBeLessThan(0.01);
        }
      }
    }
    scene.dispose();
    engine.dispose();
  }
});
