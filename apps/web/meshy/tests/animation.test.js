import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { autoBoneMap, retargetHumanoid } from "../src/retarget.ts";
import { bindHumanoid, fitHumanoid } from "../src/rigging.ts";
import { loadAnimationFiles } from "../src/animation-loader.js";

const bytes = readFileSync(new URL("../assets/quaternius-standard.glb", import.meta.url));
const library = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
function target(scale = 1) {
  const root = new THREE.Group();
  for (const [size, at] of [
    [
      [0.36, 0.7, 0.2],
      [0, 1.2, 0],
    ],
    [
      [0.22, 0.28, 0.2],
      [0, 1.78, 0],
    ],
    [
      [0.12, 0.85, 0.14],
      [-0.12, 0.52, 0],
    ],
    [
      [0.12, 0.85, 0.14],
      [0.12, 0.52, 0],
    ],
    [
      [0.62, 0.12, 0.14],
      [-0.49, 1.48, 0],
    ],
    [
      [0.62, 0.12, 0.14],
      [0.49, 1.48, 0],
    ],
  ]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size.map((v) => v * scale)),
      new THREE.MeshStandardMaterial(),
    );
    mesh.position.set(...at.map((v) => v * scale));
    root.add(mesh);
  }
  return bindHumanoid(root, fitHumanoid(root));
}
const transforms = (root) => {
  const result = [];
  root.traverse((n) =>
    result.push([n.name, ...n.position.toArray(), ...n.quaternion.toArray(), ...n.scale.toArray()]),
  );
  return result;
};
const options = (s, t, extra = {}) => ({
  sourceMap: autoBoneMap(s),
  targetMap: autoBoneMap(t),
  ...extra,
});

test("CC0 catalogue maps all 22 roles and all 45 actions transfer without changing either input", () => {
  const rig = target(),
    beforeSource = transforms(library.scene),
    beforeTarget = transforms(rig.root);
  assert.equal(Object.keys(autoBoneMap(library.scene)).length, 22);
  const actions = library.animations.filter((c) => c.name !== "A_TPose");
  assert.equal(actions.length, 45);
  for (const sourceClip of actions) {
    const clip = retargetHumanoid(
      library.scene,
      rig.root,
      sourceClip,
      options(library.scene, rig.root),
    );
    assert.ok(clip.validate(), sourceClip.name);
    assert.equal(clip.tracks.length, 23);
    const mixer = new THREE.AnimationMixer(rig.root);
    mixer.clipAction(clip).play();
    mixer.update(clip.duration * 0.4);
    for (const bone of rig.skeleton.bones) assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-5);
    mixer.stopAllAction();
    mixer.uncacheRoot(rig.root);
  }
  assert.deepEqual(transforms(library.scene), beforeSource);
  // AnimationMixer may normalize tiny float error; retarget itself never mutates its inputs.
  const before = transforms(rig.root);
  retargetHumanoid(library.scene, rig.root, actions[0], options(library.scene, rig.root));
  assert.deepEqual(transforms(rig.root), before);
  assert.equal(beforeTarget.length, before.length);
});

test("root motion scales to target height, in-place retains vertical movement, and lengths stay fixed", () => {
  const source = target(),
    dest = target(2);
  const hipName = source.bones.Hips.name,
    rest = source.bones.Hips.position;
  const clip = new THREE.AnimationClip("translation", 1, [
    new THREE.VectorKeyframeTrack(
      `${hipName}.position`,
      [0, 1],
      [...rest.toArray(), rest.x + 1, rest.y + 0.2, rest.z + 0.5],
    ),
  ]);
  const full = retargetHumanoid(
    source.root,
    dest.root,
    clip,
    options(source.root, dest.root, { inPlace: false }),
  );
  const fixed = retargetHumanoid(source.root, dest.root, clip, options(source.root, dest.root));
  const p = full.tracks.find((t) => t.name.endsWith(".position")),
    f = fixed.tracks.find((t) => t.name.endsWith(".position"));
  assert.ok(Math.abs(p.values.at(-3) - p.values[0] - 2) < 1e-5);
  assert.ok(Math.abs(p.values.at(-2) - p.values[1] - 0.4) < 1e-5);
  assert.equal(f.values.at(-3), f.values[0]);
  assert.equal(f.values.at(-1), f.values[2]);
  assert.ok(Math.abs(f.values.at(-2) - f.values[1] - 0.4) < 1e-5);
  const lengths = dest.skeleton.bones.map((b) => b.position.length());
  const mixer = new THREE.AnimationMixer(dest.root);
  mixer.clipAction(full).play();
  mixer.update(0.5);
  dest.skeleton.bones
    .slice(1)
    .forEach((b, i) => assert.ok(Math.abs(b.position.length() - lengths[i + 1]) < 1e-5));
  mixer.stopAllAction();
});

test("manual bone maps work and invalid mappings or key data fail without modifying the target", () => {
  const rig = target(),
    sourceMap = autoBoneMap(library.scene),
    targetMap = autoBoneMap(rig.root);
  const renamed = {};
  Object.entries(targetMap).forEach(([role, name], i) => {
    const bone = rig.root.getObjectByName(name);
    bone.name = `Bone_${i}`;
    renamed[role] = bone.name;
  });
  assert.equal(Object.keys(autoBoneMap(rig.root)).length, 0);
  const clip = library.animations.find((c) => c.name === "Walk_Loop"),
    opts = { sourceMap, targetMap: renamed },
    before = transforms(rig.root);
  assert.ok(retargetHumanoid(library.scene, rig.root, clip, opts).validate());
  assert.throws(
    () =>
      retargetHumanoid(library.scene, rig.root, clip, {
        ...opts,
        targetMap: { ...renamed, Head: "" },
      }),
    /Сопоставьте/,
  );
  assert.throws(
    () =>
      retargetHumanoid(library.scene, rig.root, clip, {
        ...opts,
        targetMap: { ...renamed, Head: renamed.Hips },
      }),
    /двум суставам/,
  );
  const bad = clip.clone();
  bad.tracks[0].values[0] = NaN;
  assert.throws(() => retargetHumanoid(library.scene, rig.root, bad, opts), /некорректные/);
  assert.deepEqual(transforms(rig.root), before);
});

test("importing separate GLB keeps its clips and reports a file without clips", async () => {
  const result = await loadAnimationFiles([new File([bytes], "motions.glb")]);
  assert.equal(result.animations.length, 46);
  assert.equal(Object.keys(autoBoneMap(result.root)).length, 22);
  const empty = new File(
    [JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 })],
    "empty.gltf",
  );
  await assert.rejects(loadAnimationFiles([empty]), /нет анимационных/);
});

test("export/reimport keeps retargeted walking, sword motion, skeleton and real bone playback", async () => {
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
    constructor(type, opts) {
      this.type = type;
      Object.assign(this, opts);
    }
  };
  try {
    const rig = target();
    const clips = ["Walk_Loop", "Sword_Attack"].map((name) =>
      retargetHumanoid(
        library.scene,
        rig.root,
        library.animations.find((c) => c.name === name),
        options(library.scene, rig.root),
      ),
    );
    const binary = await new GLTFExporter().parseAsync(rig.root, {
      binary: true,
      animations: clips,
    });
    const result = await new GLTFLoader().parseAsync(binary, "");
    assert.deepEqual(
      result.animations.map((c) => c.name),
      ["Walk_Loop", "Sword_Attack"],
    );
    assert.equal(Object.keys(autoBoneMap(result.scene)).length, 22);
    const bone = result.scene.getObjectByName(rig.bones.LeftLeg.name),
      before = bone.quaternion.clone();
    const mixer = new THREE.AnimationMixer(result.scene);
    mixer.clipAction(result.animations[0]).play();
    mixer.update(0.3);
    assert.ok(bone.quaternion.angleTo(before) > 0.1);
  } finally {
    globalThis.FileReader = oldReader;
    globalThis.ProgressEvent = oldEvent;
  }
});

test("FBX-style initial pelvis offset is removed while vertical motion survives", () => {
  const source = target(),
    dest = target();
  const hip = source.bones.Hips;
  const values = [
    hip.position.x + 3,
    hip.position.y + 10,
    hip.position.z - 2,
    hip.position.x + 4,
    hip.position.y + 10.2,
    hip.position.z - 1,
  ];
  const clip = new THREE.AnimationClip("offset", 1, [
    new THREE.VectorKeyframeTrack(`${hip.name}.position`, [0, 1], values),
  ]);
  const moved = retargetHumanoid(
    source.root,
    dest.root,
    clip,
    options(source.root, dest.root, { inPlace: false }),
  );
  const p = moved.tracks.find((t) => t.name.endsWith(".position")).values;
  assert.ok(new THREE.Vector3(...p.slice(0, 3)).distanceTo(dest.bones.Hips.position) < 1e-5);
  assert.ok(Math.abs(p.at(-2) - p[1] - 0.2) < 1e-5);
  assert.ok(Math.abs(p.at(-3) - p[0] - 1) < 1e-5);
});

test("separate glTF loads its BIN without fetching unused source textures", async () => {
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + bytes.readUInt32LE(12))),
  );
  const start = 20 + bytes.readUInt32LE(12),
    bin = bytes.subarray(start + 8, start + 8 + bytes.readUInt32LE(start));
  json.buffers[0].uri = "motion.bin";
  json.images = [{ uri: "https://missing.invalid/image?id=1" }];
  json.textures = [{ source: 0 }];
  json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  json.meshes.forEach((m) => m.primitives.forEach((p) => (p.material = 0)));
  const oldEvent = globalThis.ProgressEvent;
  globalThis.ProgressEvent = class {
    constructor(type, opts) {
      this.type = type;
      Object.assign(this, opts);
    }
  };
  try {
    const loaded = await loadAnimationFiles([
      new File([JSON.stringify(json)], "motion.gltf"),
      new File([bin], "motion.bin"),
    ]);
    assert.equal(loaded.animations.length, 46);
    assert.equal(Object.keys(autoBoneMap(loaded.root)).length, 22);
  } finally {
    globalThis.ProgressEvent = oldEvent;
  }
});
