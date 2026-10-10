import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { PLYExporter } from "three/addons/exporters/PLYExporter.js";
import { USDZExporter } from "three/addons/exporters/USDZExporter.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { zipSync, strToU8 } from "fflate";

export const formats = [
  {
    id: "glb",
    name: "GLB",
    title: "Модель целиком в одном файле",
    tag: "WEB / GAME",
    note: "Геометрия, PBR-материалы, текстуры, скелет и анимации. Оптимальный вариант для веба и дальнейшего редактирования.",
  },
  {
    id: "gltf",
    name: "glTF",
    title: "JSON + BIN + текстуры в ZIP",
    tag: "OPEN",
    note: "Те же данные, что в GLB, в отдельных файлах. Распакуйте архив перед импортом; связанные файлы должны оставаться рядом.",
  },
  {
    id: "obj",
    name: "OBJ",
    title: "Геометрия + MTL + текстуры в ZIP",
    tag: "DCC",
    note: "Геометрия, UV, цвет и normal map. PBR metallic/roughness, скелет и анимации не сохраняются. Для анимированных моделей экспортируется текущая поза.",
  },
  {
    id: "stl",
    name: "STL",
    title: "Компактная бинарная геометрия",
    tag: "PRINT",
    note: "Только треугольники текущей позы, без цвета и текстур. Единицы измерения не записываются; пригодность к 3D-печати не проверяется.",
  },
  {
    id: "ply",
    name: "PLY",
    title: "Геометрия, нормали и UV",
    tag: "MESH",
    note: "Бинарный PLY: геометрия, нормали, UV и цвета вершин, если они есть. Текстуры, материалы, скелет и анимации не сохраняются.",
  },
  {
    id: "usdz",
    name: "USDZ",
    title: "Статическая модель для Apple AR",
    tag: "AR",
    note: "Текущая поза и базовые PBR-материалы с текстурами. Скелет, анимации и двусторонность поверхностей не сохраняются. AR-размер зависит от исходного масштаба модели.",
  },
];

export function safeName(value) {
  return (
    value
      .trim()
      .replace(/\.(glb|gltf|obj|stl|ply|usdz|meshy|zip)$/i, "")
      .replace(/[^\p{L}\p{N}_\- .]/gu, "_")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 80) || "model"
  );
}

export function exportClone(root, originalMaterials) {
  const copy = clone(root);
  const sources = [],
    copies = [];
  const materialCache = new Map(),
    textureCache = new Map();
  const cloneMaterial = (original) => {
    if (materialCache.has(original)) return materialCache.get(original);
    const material = original.clone();
    for (const [slot, texture] of Object.entries(original))
      if (texture?.isTexture) {
        if (!textureCache.has(texture)) {
          const result = texture.clone();
          result.userData = { ...texture.userData, mimeType: "image/png" };
          textureCache.set(texture, result);
        }
        material[slot] = textureCache.get(texture);
      }
    materialCache.set(original, material);
    return material;
  };
  root.traverse((n) => sources.push(n));
  copy.traverse((n) => copies.push(n));
  sources.forEach((source, index) => {
    const node = copies[index];
    // Anonymous glTF animation targets can be addressed by UUID.
    node.uuid = source.uuid;
    if (source.isMesh) {
      const material = originalMaterials.get(source.uuid) ?? source.material;
      node.material = Array.isArray(material)
        ? material.map(cloneMaterial)
        : cloneMaterial(material);
    }
    // Loader metadata can reference original buffers/extensions that no longer exist.
    node.userData = {};
  });
  copy.updateMatrixWorld(true);
  return copy;
}

export function flattenStatic(root) {
  const result = new THREE.Group();
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry.attributes.position || !mesh.visible) return;
    if (mesh.isInstancedMesh)
      throw new Error(
        "Для модели с инстансами используйте GLB или glTF. Статический экспорт инстансов пока не поддерживается.",
      );
    mesh.skeleton?.update();
    const source = mesh.geometry;
    const position = source.attributes.position;
    const normal = source.attributes.normal;
    const point = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const positions = new Float32Array(position.count * 3);
    const normals = normal && new Float32Array(normal.count * 3);
    for (let i = 0; i < position.count; i++) {
      mesh
        .getVertexPosition(i, point)
        .applyMatrix4(mesh.matrixWorld)
        .toArray(positions, i * 3);
      if (normal) {
        point.fromBufferAttribute(normal, i);
        // Bake skinning into normal directions as well as into positions.
        if (mesh.isSkinnedMesh) {
          const skinIndex = source.attributes.skinIndex,
            skinWeight = source.attributes.skinWeight;
          const boneMatrix = new THREE.Matrix4();
          const total = new THREE.Matrix4();
          total.elements.fill(0);
          for (let b = 0; b < 4; b++) {
            const weight = skinWeight.getComponent(i, b);
            if (weight) {
              boneMatrix.fromArray(mesh.skeleton.boneMatrices, skinIndex.getComponent(i, b) * 16);
              for (let k = 0; k < 16; k++) total.elements[k] += boneMatrix.elements[k] * weight;
            }
          }
          total.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
          point.transformDirection(total);
        }
        point.applyNormalMatrix(normalMatrix).toArray(normals, i * 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (normals) geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    for (const name of ["uv", "color"]) {
      const attribute = source.attributes[name];
      if (attribute) {
        const values = new Float32Array(attribute.count * attribute.itemSize);
        for (let i = 0; i < attribute.count; i++)
          for (let c = 0; c < attribute.itemSize; c++)
            values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
      }
    }
    if (source.index) geometry.setIndex(source.index.clone());
    // Mirroring transforms require winding reversal after baking.
    if (mesh.matrixWorld.determinant() < 0) {
      if (!geometry.index) geometry.setIndex(Array.from({ length: position.count }, (_, i) => i));
      const indices = geometry.index.array;
      for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
    geometry.groups = source.groups.map((group) => ({ ...group }));
    geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
    if (!normal) geometry.computeVertexNormals();
    const baked = new THREE.Mesh(geometry, mesh.material);
    baked.name = mesh.name || `mesh_${result.children.length + 1}`;
    result.add(baked);
  });
  result.updateMatrixWorld(true);
  return result;
}

export function textureCanvas(texture, limit = 4096) {
  const image = texture.image;
  if (!image || (!image.width && !image.videoWidth))
    throw new Error("Эта текстура не может быть преобразована в PNG.");
  const width = image.width || image.videoWidth,
    height = image.height || image.videoHeight;
  const ratio = Math.min(1, limit / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext("2d");
  if (image.data) {
    const raw = document.createElement("canvas");
    raw.width = width;
    raw.height = height;
    const data = new Uint8ClampedArray(width * height * 4);
    const stride = image.data.length / (width * height);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = image.data[i * stride];
      data[i * 4 + 1] = image.data[i * stride + Math.min(1, stride - 1)];
      data[i * 4 + 2] = image.data[i * stride + Math.min(2, stride - 1)];
      data[i * 4 + 3] = stride === 4 ? image.data[i * stride + 3] : 255;
    }
    raw.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
    context.drawImage(raw, 0, 0, canvas.width, canvas.height);
  } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function pngBytes(texture, limit) {
  const canvas = textureCanvas(texture, limit);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Не удалось сохранить текстуру.");
  return new Uint8Array(await blob.arrayBuffer());
}

function splitGroups(root) {
  const result = new THREE.Group();
  for (const mesh of root.children) {
    const source = mesh.geometry;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const total = source.index?.count ?? source.attributes.position.count;
    const groups = source.groups.length
      ? source.groups
      : [{ start: 0, count: total, materialIndex: 0 }];
    for (const group of groups) {
      const start = Math.max(group.start, source.drawRange.start);
      const end = Math.min(
        group.start + group.count,
        total,
        source.drawRange.start + source.drawRange.count,
      );
      if (end <= start) continue;
      const geometry = source.clone();
      geometry.clearGroups();
      const indices = Array.from({ length: end - start }, (_, i) =>
        source.index ? source.index.getX(start + i) : start + i,
      );
      geometry.setIndex(indices);
      geometry.setDrawRange(0, Infinity);
      const material = materials[group.materialIndex] ?? materials[0];
      const part = new THREE.Mesh(geometry, material.clone());
      part.name = `${mesh.name}_${group.materialIndex}`;
      result.add(part);
    }
  }
  return result;
}

async function objArchive(root, name, limit) {
  const parts = splitGroups(root),
    files = {},
    mtl = [];
  const uv = new THREE.Vector2();
  for (let i = 0; i < parts.children.length; i++) {
    const mesh = parts.children[i],
      material = mesh.material;
    material.name = `material_${i + 1}`;
    const color = material.color?.clone().convertLinearToSRGB() ?? new THREE.Color(1, 1, 1);
    mtl.push(
      `newmtl ${material.name}\nKd ${color.r} ${color.g} ${color.b}\nd ${material.opacity ?? 1}\nillum 2`,
    );
    if (material.map && mesh.geometry.attributes.uv) {
      material.map.updateMatrix();
      const coords = mesh.geometry.attributes.uv;
      for (let vertex = 0; vertex < coords.count; vertex++) {
        uv.fromBufferAttribute(coords, vertex).applyMatrix3(material.map.matrix);
        coords.setXY(vertex, uv.x, material.map.flipY ? uv.y : 1 - uv.y);
      }
    }
    for (const [slot, keyword, suffix] of [
      ["map", "map_Kd", "color"],
      ["normalMap", "norm", "normal"],
    ]) {
      const texture = material[slot];
      if (texture) {
        const textureName = `${material.name}_${suffix}.png`;
        files[textureName] = await pngBytes(texture, limit);
        mtl.push(`${keyword} ${textureName}`);
      }
    }
    mtl.push("");
  }
  files[`${name}.obj`] = strToU8(`mtllib ${name}.mtl\n${new OBJExporter().parse(parts)}`);
  files[`${name}.mtl`] = strToU8(mtl.join("\n"));
  files["README.txt"] = strToU8(
    "OBJ + MTL + PNG. Оставьте файлы в одной папке. PBR metallic/roughness и анимации не сохраняются. Normal map записана как norm; поддержка этого расширения MTL зависит от импортёра.",
  );
  parts.traverse((n) => {
    n.geometry?.dispose();
    n.material?.dispose();
  });
  return zipSync(files);
}

function gltfArchive(gltf, name) {
  const files = {};
  const extract = (uri, target) => {
    if (!uri.startsWith("data:")) throw new Error("В экспортированной glTF найден внешний ресурс.");
    const decoded = atob(uri.slice(uri.indexOf(",") + 1));
    files[target] = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    return target;
  };
  for (let i = 0; i < (gltf.buffers?.length ?? 0); i++)
    gltf.buffers[i].uri = extract(gltf.buffers[i].uri, `${name}${i ? `_${i}` : ""}.bin`);
  for (let i = 0; i < (gltf.images?.length ?? 0); i++) {
    const image = gltf.images[i];
    if (image.uri)
      image.uri = extract(
        image.uri,
        `texture_${i + 1}.${image.uri.startsWith("data:image/jpeg") ? "jpg" : image.uri.startsWith("data:image/webp") ? "webp" : "png"}`,
      );
  }
  files[`${name}.gltf`] = strToU8(JSON.stringify(gltf, null, 2));
  return zipSync(files);
}

export async function exportModel({
  root,
  originalMaterials,
  animations,
  format,
  name,
  textureSize,
  includeAnimations,
}) {
  const copy = exportClone(root, originalMaterials);
  let baked;
  try {
    if (format === "glb" || format === "gltf") {
      const exporter = new GLTFExporter();
      const data = await exporter.parseAsync(copy, {
        binary: format === "glb",
        animations: includeAnimations ? animations : [],
        maxTextureSize: textureSize,
      });
      return {
        data: format === "glb" ? data : gltfArchive(data, name),
        extension: format === "glb" ? "glb" : "gltf.zip",
      };
    }
    baked = flattenStatic(copy);
    if (format === "obj")
      return { data: await objArchive(baked, name, textureSize), extension: "obj.zip" };
    if (format === "stl")
      return { data: new STLExporter().parse(baked, { binary: true }), extension: "stl" };
    if (format === "ply")
      return {
        data: new PLYExporter().parse(baked, undefined, { binary: true, littleEndian: true }),
        extension: "ply",
      };
    if (format === "usdz") {
      const parts = splitGroups(baked);
      try {
        // USDZ only supports front-sided materials; reflect this explicitly in the UI.
        parts.traverse((n) => {
          if (n.material) n.material.side = THREE.FrontSide;
        });
        return {
          data: await new USDZExporter().parseAsync(parts, {
            maxTextureSize: textureSize,
            quickLookCompatible: true,
          }),
          extension: "usdz",
        };
      } finally {
        parts.traverse((n) => {
          n.geometry?.dispose();
          n.material?.dispose();
        });
      }
    }
    throw new Error("Неизвестный формат экспорта.");
  } finally {
    baked?.traverse((n) => n.geometry?.dispose());
    const materials = new Set(),
      textures = new Set();
    copy.traverse((n) => {
      for (const material of Array.isArray(n.material) ? n.material : [n.material])
        if (material) {
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
    });
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
}

export function download(data, filename, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
