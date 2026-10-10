import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  bindHumanoid,
  copyLayout,
  disposeRig,
  fitHumanoid,
  JOINTS,
  moveJoint,
  poseRig,
} from "../src/rigging.ts";
import { exportClone } from "../src/exports.js";

function humanoid(pose = "T") {
  const root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial({ color: 0x9fb7ab });
  const add = (size, at, angle = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.rotation.z = angle;
    root.add(mesh);
    return mesh;
  };
  add([0.36, 0.7, 0.2], [0, 1.2, 0]);
  add([0.22, 0.28, 0.2], [0, 1.78, 0]);
  for (const sign of [-1, 1]) {
    add([0.12, 0.85, 0.14], [sign * 0.12, 0.52, 0]);
    add([0.15, 0.14, 0.32], [sign * 0.12, 0.09, 0.08]);
    add(
      [0.62, 0.12, 0.14],
      [sign * 0.49, pose === "T" ? 1.48 : 1.2, 0],
      pose === "T" ? 0 : -sign * 0.6,
    );
  }
  root.updateMatrixWorld(true);
  return root;
}

test("T/A fits are complete and ignore presentation scale/offset", () => {
  for (const pose of ["T", "A"]) {
    const root = humanoid(pose),
      original = fitHumanoid(root);
    const display = new THREE.Group();
    display.scale.setScalar(23);
    display.position.set(50, -30, 5);
    display.add(root);
    const fitted = fitHumanoid(root);
    assert.equal(Object.keys(fitted.layout).length, 22);
    for (const [name] of JOINTS)
      assert.ok(fitted.layout[name].distanceTo(original.layout[name]) < 1e-10);
    assert.ok(fitted.layout.LeftHand.x > fitted.layout.LeftForeArm.x);
    assert.ok(fitted.layout.LeftLeg.y < fitted.layout.Hips.y);
    if (pose === "A") assert.ok(fitted.layout.LeftHand.y < fitted.layout.LeftArm.y);
  }
});

test("joint adjustment mirrors around the fitted center and snapshots are independent", () => {
  const draft = fitHumanoid(humanoid()),
    before = copyLayout(draft.layout);
  moveJoint(
    draft,
    "LeftForeArm",
    draft.layout.LeftForeArm.clone().add(new THREE.Vector3(0.1, 0.02, 0.03)),
    true,
  );
  assert.equal(draft.layout.LeftForeArm.y, draft.layout.RightForeArm.y);
  assert.equal(draft.layout.RightForeArm.x, 2 * draft.centerX - draft.layout.LeftForeArm.x);
  assert.notDeepEqual(draft.layout.LeftForeArm.toArray(), before.LeftForeArm.toArray());
  assert.throws(() => moveJoint(draft, "Hips", new THREE.Vector3(NaN, 0, 0), true), /конечными/);
});

test("collar weights vary continuously across closest-bone and top-four boundaries", () => {
  const root = humanoid(),
    draft = fitHumanoid(root);
  const coordinates = [];
  for (let row = 0; row < 5; row++)
    for (let x = 0; x <= 2000; x++)
      coordinates.push(
        draft.centerX + x * draft.height * 0.0001,
        draft.layout.Neck.y + (row - 2) * draft.height * 0.015,
        draft.layout.Neck.z + draft.height * 0.025,
      );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(coordinates, 3));
  root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  for (const softness of [0.4, 1, 2]) {
    const rig = bindHumanoid(root, draft, new Map(), softness),
      probe = rig.meshes.at(-1).geometry,
      indices = probe.getAttribute("skinIndex"),
      weights = probe.getAttribute("skinWeight");
    const dense = (vertex) => {
      const vector = new Array(rig.skeleton.bones.length).fill(0);
      for (let k = 0; k < 4; k++)
        vector[indices.getComponent(vertex, k)] += weights.getComponent(vertex, k);
      return vector;
    };
    for (let row = 0; row < 5; row++)
      for (let x = 1; x <= 2000; x++) {
        const a = dense(row * 2001 + x - 1),
          b = dense(row * 2001 + x);
        const change = a.reduce((sum, w, i) => sum + Math.abs(w - b[i]), 0);
        assert.ok(change < 0.05, `softness=${softness}, row=${row}, x=${x}: ${change}`);
      }
    disposeRig(rig);
  }
});

test("binding preserves rest vertices, root transform and original geometry/material", () => {
  const source = humanoid();
  source.position.set(2, 3, 4);
  source.rotation.y = 0.2;
  source.scale.setScalar(2);
  const draft = fitHumanoid(source),
    originals = source.children.map((mesh) => mesh.geometry);
  const rig = bindHumanoid(source, draft);
  assert.deepEqual(rig.root.position.toArray(), source.position.toArray());
  source.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);
  rig.skeleton.update();
  rig.meshes.forEach((mesh, index) => {
    assert.notEqual(mesh.geometry, originals[index]);
    assert.equal(mesh.material, source.children[index].material);
    const positions = mesh.geometry.getAttribute("position");
    for (let v = 0; v < positions.count; v++) {
      const expected = source.children[index]
        .getVertexPosition(v, new THREE.Vector3())
        .applyMatrix4(source.children[index].matrixWorld);
      const actual = mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      assert.ok(actual.distanceTo(expected) < 1e-5);
    }
    assert.equal(originals[index].hasAttribute("skinWeight"), false);
  });
  disposeRig(rig);
});

test("all four skin weights are normalized, finite, nonnegative and refer to valid bones", () => {
  const source = humanoid(),
    draft = fitHumanoid(source);
  for (const softness of [0.4, 1, 2]) {
    const rig = bindHumanoid(source, draft, new Map(), softness);
    for (const mesh of rig.meshes) {
      const weights = mesh.geometry.getAttribute("skinWeight"),
        indices = mesh.geometry.getAttribute("skinIndex");
      for (let i = 0; i < weights.count; i++) {
        let total = 0;
        for (let j = 0; j < 4; j++) {
          const w = weights.getComponent(i, j);
          assert.ok(Number.isFinite(w) && w >= 0);
          total += w;
          assert.ok(indices.getComponent(i, j) < rig.skeleton.bones.length);
          if (w === 0) assert.equal(indices.getComponent(i, j), 0);
        }
        assert.ok(Math.abs(total - 1) < 1e-6);
      }
    }
    disposeRig(rig);
  }
});

test("elbow pose deforms hands, keeps opposite leg stable, and rest restores the mesh", () => {
  const source = humanoid(),
    draft = fitHumanoid(source),
    rig = bindHumanoid(source, draft);
  const arm = rig.meshes[4],
    leg = rig.meshes[2];
  const position = arm.geometry.getAttribute("position");
  let handVertex = 0;
  for (let i = 1; i < position.count; i++)
    if (position.getX(i) < position.getX(handVertex)) handVertex = i;
  const before = arm.getVertexPosition(handVertex, new THREE.Vector3()),
    legBefore = leg.getVertexPosition(0, new THREE.Vector3());
  poseRig(rig, Math.PI / 2, 0);
  assert.ok(arm.getVertexPosition(handVertex, new THREE.Vector3()).distanceTo(before) > 0.02);
  assert.ok(leg.getVertexPosition(0, new THREE.Vector3()).distanceTo(legBefore) < 1e-5);
  poseRig(rig, 0, 0);
  assert.ok(arm.getVertexPosition(handVertex, new THREE.Vector3()).distanceTo(before) < 1e-5);
  disposeRig(rig);
});

test("existing rigs, instances, excessive geometry and coincident joints fail explicitly", () => {
  const root = new THREE.Group();
  root.add(new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  assert.throws(() => fitHumanoid(root), /уже есть скелет/);
  const instance = new THREE.Group();
  instance.add(
    new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2),
  );
  assert.throws(() => fitHumanoid(instance), /инстансы/);
  const huge = new THREE.Group(),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(200001 * 3), 3),
  );
  huge.add(new THREE.Mesh(geometry));
  assert.throws(() => fitHumanoid(huge), /200 000/);
  const source = humanoid(),
    draft = fitHumanoid(source);
  draft.layout.LeftForeArm.copy(draft.layout.LeftArm);
  assert.throws(() => bindHumanoid(source, draft), /не должны совпадать/);
});

test("glTF export/reimport keeps the edited 22-joint skin with forearm helpers and both diagnostic animation clips", async () => {
  const oldReader = globalThis.FileReader,
    oldEvent = globalThis.ProgressEvent;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((value) => {
        this.result = value;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((value) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(value).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
  globalThis.ProgressEvent = class {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
  };
  let rig;
  try {
    const source = humanoid(),
      draft = fitHumanoid(source);
    draft.layout.LeftLeg.z += 0.03;
    rig = bindHumanoid(source, draft);
    const display = new THREE.Group();
    display.scale.setScalar(30);
    display.add(rig.root);
    display.updateMatrixWorld(true);
    const copy = exportClone(rig.root, new Map());
    const json = await new GLTFExporter().parseAsync(copy, { animations: rig.animations });
    assert.equal(json.skins[0].joints.length, 26);
    assert.equal(json.animations.length, 2);
    const loaded = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
    const skins = [];
    loaded.scene.traverse((node) => {
      if (node.isSkinnedMesh) skins.push(node);
    });
    assert.equal(skins.length, rig.meshes.length);
    assert.equal(loaded.animations.length, 2);
    const knee = loaded.scene.getObjectByName("MeshStudio_LeftLeg");
    assert.ok(knee.position.distanceTo(rig.bones.LeftLeg.position) < 1e-6);
    const mixer = new THREE.AnimationMixer(loaded.scene);
    mixer.clipAction(loaded.animations[0]).play();
    mixer.update(2);
    assert.ok(
      loaded.scene
        .getObjectByName("MeshStudio_LeftForeArm")
        .quaternion.angleTo(new THREE.Quaternion()) > 0.5,
    );
  } finally {
    if (rig) disposeRig(rig);
    globalThis.FileReader = oldReader;
    globalThis.ProgressEvent = oldEvent;
  }
});
