import { LoadingManager, MeshBasicMaterial } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { disposeModel, extensionOf } from "./loaders.js";
import { rigBones } from "./retarget.ts";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

// Animation sources are never added to the viewport. Textures are unnecessary.
export async function loadAnimationFiles(fileList, { resources = new Map() } = {}) {
  const files = [...fileList],
    file = files.find((f) => ["glb", "gltf", "fbx"].includes(extensionOf(f.name)));
  if (!file) throw new Error("Выберите анимацию GLB, glTF (вместе с BIN) или FBX.");
  if (files.reduce((bytes, f) => bytes + f.size, 0) > 200 * 1024 * 1024)
    throw new Error("Анимация со связанными файлами превышает лимит 200 МБ.");
  const extension = extensionOf(file.name),
    urls = new Map(),
    manager = new LoadingManager();
  const selected = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  manager.setURLModifier((url) => {
    if (
      extension === "fbx" ||
      url.startsWith("blob:") ||
      url.startsWith("data:image/") ||
      /\.(png|jpe?g|webp|gif|bmp|tga)([?#]|$)/i.test(url)
    )
      return pixel;
    if (url.startsWith("data:")) return url;
    let path;
    try {
      path = decodeURIComponent(url.replace(/^\.\//, ""));
    } catch {
      path = url;
    }
    const resource =
      resources.get(url) ??
      resources.get(path) ??
      selected.get(path.toLowerCase()) ??
      selected.get(path.split("/").pop().toLowerCase());
    if (!resource) throw new Error(`Не найден BIN-файл «${path}». Выберите его вместе с glTF.`);
    if (!urls.has(resource)) urls.set(resource, URL.createObjectURL(resource));
    return urls.get(resource);
  });
  let root;
  try {
    const buffer = await file.arrayBuffer();
    let animations;
    if (extension === "fbx") {
      root = new FBXLoader(manager).parse(buffer, "");
      animations = root.animations;
    } else {
      const gltf = await new GLTFLoader(manager)
        .setMeshoptDecoder(MeshoptDecoder)
        .register(() => ({
          name: "AnimationSourceMaterial",
          loadMaterial: () => Promise.resolve(new MeshBasicMaterial()),
        }))
        .parseAsync(buffer, "");
      root = gltf.scene;
      animations = gltf.animations;
    }
    if (!animations.length) throw new Error("В файле нет анимационных клипов.");
    rigBones(root);
    return { root, animations, file };
  } catch (error) {
    if (root) disposeModel(root);
    throw error;
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}
