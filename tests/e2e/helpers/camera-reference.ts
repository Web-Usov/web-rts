import { expect, type Page } from "@playwright/test";

/**
 * E2E-only ground fiducial, independent of camera.ts. A thin, unlit magenta
 * cross has a visible center on y=0, unlike the elevated, shaded MOVE cylinder.
 * It is placed once with Babylon's forward ground ray, then never repositioned
 * during zoom. No production hook or authoritative/gameplay state is involved.
 */
export async function installGroundReference(page: Page, point: { x: number; y: number }) {
  await page.evaluate(async (point) => {
    // These are the Vite development modules already used by the actual scene.
    const deps = "/node_modules/.vite/deps/";
    const { Engine } = await import(`${deps}@babylonjs_core_Engines_engine__js.js`);
    const { MeshBuilder } = await import(`${deps}@babylonjs_core_Meshes_meshBuilder__js.js`);
    const { StandardMaterial } = await import(
      `${deps}@babylonjs_core_Materials_standardMaterial__js.js`
    );
    const { Color3 } = await import(`${deps}@babylonjs_core_Maths_math__color__js.js`);
    const { Matrix } = await import(`${deps}@babylonjs_core_Maths_math__vector__js.js`);
    const scene = Engine.Instances[0].scenes[0];
    for (const name of ["e2e-reference-x", "e2e-reference-z"]) scene.getMeshByName(name)?.dispose();
    scene.getMaterialByName("e2e-reference")?.dispose();
    const ray = scene.createPickingRay(point.x, point.y, Matrix.Identity(), scene.activeCamera);
    if (ray.direction.y >= 0) throw new Error("Reference must use a forward ground ray");
    const ground = ray.origin.add(ray.direction.scale(-ray.origin.y / ray.direction.y));
    const material = new StandardMaterial("e2e-reference", scene);
    material.disableLighting = true;
    material.emissiveColor = new Color3(1, 0, 1);
    // Render coplanar with the terrain, with depth bias to avoid z-fighting.
    material.zOffset = -2;
    for (const [name, width, height] of [
      ["e2e-reference-x", 0.8, 0.12],
      ["e2e-reference-z", 0.12, 0.8],
    ] as const) {
      const mesh = MeshBuilder.CreateGround(name, { width, height }, scene);
      mesh.position.copyFrom(ground);
      mesh.isPickable = false;
      mesh.material = material;
    }
  }, point);
}

/** Full canvas screenshot, CSS scaling, unique colour and no fixed crop. */
export async function measureGroundReference(page: Page) {
  const box = await page.locator("#game-canvas").boundingBox();
  expect(box).not.toBeNull();
  const png = await page.screenshot({ clip: box! });
  const sample = await page.evaluate(
    async ({ b64, box }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let minX = width,
        maxX = -1,
        minY = height,
        maxY = -1,
        count = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (data[i]! > 220 && data[i + 1]! < 40 && data[i + 2]! > 220) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            count++;
          }
        }
      return {
        x: (((minX + maxX) / 2) * box.width) / width + box.x,
        y: (((minY + maxY) / 2) * box.height) / height + box.y,
        count,
        clipped: minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1,
      };
    },
    { b64: png.toString("base64"), box: box! },
  );
  expect(sample.count, "ground reference must remain visible").toBeGreaterThan(20);
  expect(sample.clipped, "ground reference must not be cropped").toBe(false);
  return sample;
}
