import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { decodeMeshy, isMeshy } from "./meshy.js";

const MODEL_EXTENSIONS = ["meshy", "glb", "gltf", "obj", "stl", "ply"];
export const extensionOf = (name) => name.split(".").pop().toLowerCase();

export function disposeModel(root) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    images = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      if (material) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) {
            textures.add(value);
            if (value.image) images.add(value.image);
          }
      }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  images.forEach((i) => i.close?.());
}

export async function loadFiles(fileList, { resources = new Map(), mtlText } = {}) {
  const files = [...fileList];
  const file = files.find((f) => MODEL_EXTENSIONS.includes(extensionOf(f.name)));
  if (!file) throw new Error("Выберите .meshy, .glb, .gltf, .obj, .stl или .ply.");
  if (file.size > 200 * 1024 * 1024) throw new Error("Для просмотра выберите файл до 200 МБ.");
  const extension = extensionOf(file.name),
    buffer = await file.arrayBuffer();
  const manager = new THREE.LoadingManager();
  const urls = new Map(),
    fileMap = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  manager.setURLModifier((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    let path;
    try {
      path = decodeURIComponent(url.replace(/^\.\//, ""));
    } catch {
      path = url;
    }
    const selected =
      resources.get(url) ??
      resources.get(path) ??
      fileMap.get(path.toLowerCase()) ??
      fileMap.get(path.split("/").pop().toLowerCase());
    if (!selected)
      throw new Error(
        `Не найден связанный файл «${path}». Выберите модель, BIN и текстуры вместе.`,
      );
    if (!urls.has(selected)) urls.set(selected, URL.createObjectURL(selected));
    return urls.get(selected);
  });
  try {
    let root,
      animations = [];
    if (["meshy", "glb", "gltf"].includes(extension)) {
      const data = isMeshy(buffer) ? await decodeMeshy(buffer) : buffer;
      if (extension === "meshy" && !isMeshy(buffer))
        throw new Error("Этот файл не является контейнером .meshy.");
      const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(data, "");
      root = gltf.scene;
      animations = gltf.animations;
    } else if (extension === "obj") {
      const loader = new OBJLoader(manager),
        mtl = files.find((f) => extensionOf(f.name) === "mtl");
      if (mtl || mtlText) {
        const materials = new MTLLoader(manager).parse(mtlText ?? (await mtl.text()), "");
        materials.preload();
        loader.setMaterials(materials);
      }
      // OBJ textures load asynchronously; wait before revoking blob URLs.
      const pending = new Promise((resolve, reject) => {
        manager.onLoad = resolve;
        manager.onError = (url) => reject(new Error(`Не удалось открыть текстуру: ${url}`));
      });
      root = loader.parse(new TextDecoder().decode(buffer));
      if (urls.size) await pending;
    } else {
      const geometry =
        extension === "stl" ? new STLLoader().parse(buffer) : new PLYLoader().parse(buffer);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      root = new THREE.Group();
      root.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: geometry.hasAttribute("color") ? 0xffffff : 0xb8c5cf,
            roughness: 0.65,
            metalness: 0.05,
            vertexColors: geometry.hasAttribute("color"),
            side: THREE.DoubleSide,
          }),
        ),
      );
    }
    let vertexCount = 0;
    root.traverse((n) => {
      if (n.isMesh) vertexCount += n.geometry.attributes.position?.count ?? 0;
    });
    if (!vertexCount) {
      disposeModel(root);
      throw new Error("В файле нет видимой меш-геометрии.");
    }
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root, true);
    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.y)) {
      disposeModel(root);
      throw new Error("Некорректные координаты геометрии.");
    }
    return { root, animations, file, extension, bounds };
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}
