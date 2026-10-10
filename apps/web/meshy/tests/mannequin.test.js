import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bindHumanoid, fitHumanoid, disposeRig } from "../src/rigging.ts";
import { autoBoneMap, retargetHumanoid } from "../src/retarget.ts";
const reference = JSON.parse(
  readFileSync(new URL("./fixtures/mannequin-reference.json", import.meta.url)),
);
async function load(name) {
  const bytes = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}
test("default mannequin is static and fitted shoulder, pelvis and wrist pivots stay near reference joints", async () => {
  const model = await load("mannequin.glb");
  assert.equal(model.animations.length, 0);
  model.scene.traverse((n) => assert.ok(!n.isSkinnedMesh && !n.isBone));
  const draft = fitHumanoid(model.scene);
  for (const name of [
    "Hips",
    "LeftShoulder",
    "RightShoulder",
    "LeftArm",
    "RightArm",
    "LeftHand",
    "RightHand",
  ])
    assert.ok(
      draft.layout[name].distanceTo(new THREE.Vector3(...reference.joints[name])) <
        draft.height * 0.025,
      name,
    );
});
test("mannequin autorig preserves chest and limbs in idle, walk and attack against original skin samples", async () => {
  const model = await load("mannequin.glb"),
    library = await load("quaternius-standard.glb"),
    draft = fitHumanoid(model.scene),
    rig = bindHumanoid(model.scene, draft);
  try {
    for (const pose of reference.poses) {
      const clip = retargetHumanoid(
        library.scene,
        rig.root,
        library.animations.find((c) => c.name === pose.name),
        { sourceMap: autoBoneMap(library.scene), targetMap: autoBoneMap(rig.root) },
      );
      const mixer = new THREE.AnimationMixer(rig.root);
      mixer.clipAction(clip).play();
      mixer.setTime(pose.time);
      rig.root.updateMatrixWorld(true);
      rig.skeleton.update();
      let squared = 0;
      for (let i = 0; i < reference.vertexIndices.length; i++) {
        const actual = rig.meshes[0].getVertexPosition(
          reference.vertexIndices[i],
          new THREE.Vector3(),
        );
        squared += actual.distanceToSquared(new THREE.Vector3(...pose.positions[i]));
      }
      const rms = Math.sqrt(squared / reference.vertexIndices.length) / draft.height;
      assert.ok(rms < (pose.name === "Sword_Attack" ? 0.02 : 0.009), `${pose.name}: ${rms}`);
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
    }
  } finally {
    disposeRig(rig);
  }
});

test("curved spine does not assign different chest weights to its front and back surfaces", async () => {
  const model = await load("mannequin.glb"),
    draft = fitHumanoid(model.scene);
  const geometry = new THREE.BufferGeometry(),
    y = draft.layout.Spine2.y - draft.height * 0.01;
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        draft.centerX,
        y,
        -draft.height * 0.07,
        draft.centerX,
        y,
        draft.height * 0.07,
        draft.centerX,
        y,
        0,
      ],
      3,
    ),
  );
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const rig = bindHumanoid(root, draft);
  try {
    const g = rig.meshes[0].geometry,
      dense = (v) => {
        const result = new Array(22).fill(0);
        for (let k = 0; k < 4; k++)
          result[g.attributes.skinIndex.getComponent(v, k)] += g.attributes.skinWeight.getComponent(
            v,
            k,
          );
        return result;
      };
    assert.deepEqual(dense(0), dense(1));
  } finally {
    disposeRig(rig);
  }
});
