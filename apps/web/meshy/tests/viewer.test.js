import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { decodeMeshy } from "../src/meshy.js";
import { demoBase64 } from "../src/demo.js";
import { exportClone, flattenStatic, safeName } from "../src/exports.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const fixture = Uint8Array.from(Buffer.from(demoBase64, "base64")).buffer;
test("real .meshy recovers GLB and all compressed triangles reference valid vertices", async () => {
  const decoded = await decodeMeshy(fixture),
    bytes = new Uint8Array(decoded),
    dv = new DataView(decoded);
  assert.equal(dv.getUint32(0, true), 0x46546c67);
  assert.equal(dv.getUint32(8, true), decoded.byteLength);
  const jsonLength = dv.getUint32(12, true),
    json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)));
  const indexAccessor = json.accessors[json.meshes[0].primitives[0].indices];
  const vertexAccessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const ext = json.bufferViews[indexAccessor.bufferView].extensions.EXT_meshopt_compression;
  const binStart = 20 + jsonLength + 8;
  const target = new Uint8Array(ext.count * ext.byteStride);
  await MeshoptDecoder.ready;
  MeshoptDecoder.decodeGltfBuffer(
    target,
    ext.count,
    ext.byteStride,
    bytes.subarray(binStart + ext.byteOffset, binStart + ext.byteOffset + ext.byteLength),
    ext.mode,
    ext.filter || "",
  );
  const indices = new Uint16Array(target.buffer);
  assert.equal(indices.length / 3, 4137);
  assert.ok(indices.every((index) => index < vertexAccessor.count));
});
test("unsupported, truncated and corrupted containers give clear failures", async () => {
  await assert.rejects(decodeMeshy(new ArrayBuffer(50)), /MESHY.AI/);
  await assert.rejects(decodeMeshy(fixture.slice(0, 100)), /обрезан/);
  const version = fixture.slice(0);
  new DataView(version).setUint16(8, 9, true);
  await assert.rejects(decodeMeshy(version), /версия/);
  const corrupt = fixture.slice(0);
  new Uint8Array(corrupt)[32] ^= 255;
  await assert.rejects(decodeMeshy(corrupt), /прочитать модель/);
});
test("export uses original material and ignores presentation parent transforms", () => {
  const root = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    original = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(geometry, original);
  mesh.position.set(2, 0, 0);
  root.add(mesh);
  const presentation = new THREE.Group();
  presentation.scale.setScalar(20);
  presentation.add(root);
  presentation.updateMatrixWorld(true);
  mesh.material = new THREE.MeshNormalMaterial();
  const copy = exportClone(root, new Map([[mesh.uuid, original]]));
  assert.equal(copy.children[0].material.color.getHex(), original.color.getHex());
  assert.equal(copy.children[0].material.wireframe, false);
  assert.equal(copy.children[0].matrixWorld.elements[12], 2);
  assert.ok(mesh.material.isMeshNormalMaterial);
});
test("static export converts quantized normalized attributes and preserves mirrored winding", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 65535, 0, 0, 0, 65535, 0]), 3, true),
  );
  geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.scale.set(-2, 2, 2);
  const root = new THREE.Group();
  root.add(mesh);
  const baked = flattenStatic(root).children[0];
  assert.ok(baked.geometry.attributes.position.array instanceof Float32Array);
  assert.equal(baked.geometry.attributes.position.getX(1), -2);
  assert.deepEqual([...baked.geometry.index.array], [0, 2, 1]);
});
test("download names do not contain directory traversal or reserved punctuation", () => {
  assert.equal(safeName(" ../model.glb "), "_model");
  assert.equal(safeName(""), "model");
});

test("static export bakes a skinned pose and keeps the live skeleton intact", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial()),
    bone = new THREE.Bone();
  bone.name = "Root";
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  bone.position.set(3, 0, 0);
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const root = new THREE.Group();
  root.add(mesh);
  const baked = flattenStatic(exportClone(root, new Map([[mesh.uuid, mesh.material]]))).children[0];
  assert.equal(baked.geometry.attributes.position.getX(0), 3);
  assert.equal(baked.geometry.attributes.normal.getZ(0), 1);
  assert.equal(bone.position.x, 3);
});
test("unsupported instanced static export fails explicitly instead of dropping instances", () => {
  const root = new THREE.Group();
  root.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2));
  assert.throws(() => flattenStatic(root), /инстансами/);
});
