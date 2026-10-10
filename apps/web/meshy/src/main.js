import "./style.css";
import { mountTransport } from "./transport.tsx";
import { seekAction, frameTime } from "./playback.ts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadFiles, disposeModel } from "./loaders.js";
import { formats, exportModel, safeName, download, textureCanvas } from "./exports.js";
import { createRigEditor } from "./rig-editor.js";
import { createAnimationEditor } from "./animation-editor.js";
import { fetchModel } from "./remote.js";
const demoURL = new URL("../assets/mannequin.glb", import.meta.url).href;

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute("aria-label", "Интерактивная 3D-модель");
viewport.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#20242a");
const environmentScene = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentTarget = pmrem.fromScene(environmentScene, 0.05);
scene.environment = environmentTarget.texture;
environmentScene.dispose();
pmrem.dispose();
scene.environmentIntensity = 1;
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.autoRotateSpeed = 1.5;
controls.minDistance = 0.05;
controls.maxDistance = 20;
const keyLight = new THREE.DirectionalLight(0xfff3e1, 2);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xc2d9ff, 0.8);
fillLight.position.set(-3, 2, -4);
scene.add(fillLight);
const grid = new THREE.GridHelper(4, 40, 0x465058, 0x333a41);
grid.material.transparent = true;
grid.material.opacity = 0.5;
scene.add(grid);
const axes = new THREE.AxesHelper(0.5);
axes.visible = false;
axes.position.set(-0.8, 0.005, 0.7);
scene.add(axes);
const displayGroup = new THREE.Group();
scene.add(displayGroup);
const viewMaterials = {
  clay: new THREE.MeshStandardMaterial({ color: 0xcccac1, roughness: 0.75, metalness: 0 }),
  normal: new THREE.MeshNormalMaterial(),
  wire: new THREE.MeshBasicMaterial({ color: 0xbce5cd, wireframe: true }),
};
let model = null,
  mixer = null,
  originalMaterials = new Map(),
  sidedMaterials = new Map();
let currentFormat = "glb",
  currentMode = "material",
  toastTimer,
  busy = false;
let currentView = "iso",
  displaySize = new THREE.Vector3(1, 1, 1),
  animationAction = null;
let rigEditor = null;
let animationEditor = null;
const formatNumber = new Intl.NumberFormat("ru-RU");
const sizeLabel = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} МБ`
    : `${Math.round(bytes / 1024)} КБ`;

let renderTransport = null;
let lastTransportFrame = 0;
function syncTransport() {
  renderTransport?.({
    clips:
      model?.animations.map((clip, index) => ({
        name: clip.name || `Анимация ${index + 1}`,
        duration: clip.duration,
      })) ?? [],
    selected: Number($("animation-select").value || 0),
    time: animationAction?.time ?? 0,
    playing: !!animationAction && !animationAction.paused,
    loop: $("animation-loop").checked,
    speed: Number($("animation-speed").value),
    busy,
  });
}
function seek(time) {
  if (!mixer || busy) return;
  if (!animationAction) setAnimation(Number($("animation-select").value));
  if (!animationAction) return;
  seekAction(mixer, animationAction, time);
  $("animation-play").checked = false;
  syncTransport();
}
function togglePlayback() {
  if (!mixer || busy) return;
  if (!animationAction) setAnimation(Number($("animation-select").value));
  if (!animationAction) return;
  const play = animationAction.paused;
  if (play && animationAction.time >= animationAction.getClip().duration)
    animationAction.reset().play();
  animationAction.paused = !play;
  $("animation-play").checked = play;
  syncTransport();
}
renderTransport = mountTransport($("transport-root"), {
  select: (index) => setAnimation(index),
  play: togglePlayback,
  seek,
  step: (direction) =>
    seek(
      frameTime(
        animationAction?.time ?? 0,
        direction,
        model?.animations[Number($("animation-select").value)]?.duration ?? 0,
      ),
    ),
  speed: (value) => {
    $("animation-speed").value = String(value);
    if (mixer) mixer.timeScale = value;
    syncTransport();
  },
  loop: (value) => {
    $("animation-loop").checked = value;
    animationAction?.setLoop(value ? THREE.LoopRepeat : THREE.LoopOnce, value ? Infinity : 1);
    syncTransport();
  },
  rest: () => $("animation-rest").click(),
});
syncTransport();

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("toast").hidden = true;
    },
    error ? 8000 : 3500,
  );
}
function loading(value, message = "Открываем модель…") {
  busy = value;
  rigEditor?.setBusy(value);
  animationEditor?.setBusy(value);
  $("loading").hidden = !value;
  $("loading-text").textContent = message;
  $("url-button").disabled = value;
  $("open-button").disabled = value;
  $("demo-button").disabled = value;
  $("export-button").disabled = value || !model;
  $("export-shortcut").disabled = value || !model;
  syncTransport();
}
function setView(view = "iso") {
  currentView = view;
  const center = new THREE.Vector3(0, displaySize.y / 2, 0);
  const aspect = camera.aspect;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const distance =
    1.3 *
      Math.max(
        displaySize.y / (2 * Math.tan(verticalFov / 2)),
        Math.max(displaySize.x, displaySize.z) / (2 * Math.tan(horizontalFov / 2)),
      ) +
    Math.max(displaySize.x, displaySize.z) / 2;
  const direction = { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0.001], iso: [1.4, 0.5, 2.2] }[
    view
  ];
  camera.position.copy(
    new THREE.Vector3(...direction).normalize().multiplyScalar(distance).add(center),
  );
  controls.target.copy(center);
  controls.update();
  document
    .querySelectorAll("[data-view]")
    .forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}
function setBackground(color) {
  scene.background.set(color);
  viewport.style.background = color;
  $("background-color").value = color;
  const light = new THREE.Color(color).getHSL({}).l > 0.6;
  viewport.classList.toggle("light-background", light);
  document
    .querySelectorAll("[data-background]")
    .forEach((button) => button.classList.toggle("active", button.dataset.background === color));
}
function setMode(mode) {
  currentMode = mode;
  const double = $("double-sided").checked;
  model?.root.traverse((node) => {
    if (!node.isMesh) return;
    if (mode === "material")
      node.material = double ? sidedMaterials.get(node.uuid) : originalMaterials.get(node.uuid);
    else {
      viewMaterials[mode].side = double ? THREE.DoubleSide : THREE.FrontSide;
      node.material = viewMaterials[mode];
    }
  });
  document
    .querySelectorAll("[data-mode]")
    .forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
}
function restoreOriginalMaterials() {
  model?.root.traverse((node) => {
    if (node.isMesh) node.material = originalMaterials.get(node.uuid);
  });
}
function resetView() {
  $("exposure").value = 1;
  $("environment").value = 1;
  $("light").value = 2;
  for (const id of ["exposure", "environment", "light"]) $(id).dispatchEvent(new Event("input"));
  $("auto-rotate").checked = false;
  controls.autoRotate = false;
  $("grid-toggle").checked = true;
  grid.visible = true;
  $("axes-toggle").checked = false;
  axes.visible = false;
  $("double-sided").checked = false;
  setMode("material");
  setBackground("#20242a");
  setView("iso");
}
function setAnimation(index) {
  mixer?.stopAllAction();
  if (!mixer || !model.animations[index]) return;
  $("animation-select").value = String(index);
  animationAction = mixer.clipAction(model.animations[index]);
  animationAction.reset();
  animationAction.setLoop(
    $("animation-loop").checked ? THREE.LoopRepeat : THREE.LoopOnce,
    $("animation-loop").checked ? Infinity : 1,
  );
  animationAction.clampWhenFinished = true;
  animationAction.play();
  animationAction.paused = !$("animation-play").checked;
  syncTransport();
}
function inspectModel() {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Map(),
    skins = new Set();
  let meshCount = 0,
    vertexCount = 0,
    triangleCount = 0;
  const slots = [
    ["map", "Цвет"],
    ["roughnessMap", "Roughness"],
    ["metalnessMap", "Metallic"],
    ["normalMap", "Нормали"],
    ["emissiveMap", "Свечение"],
    ["aoMap", "AO"],
  ];
  model.root.traverse((node) => {
    if (!node.isMesh) return;
    meshCount++;
    if (node.isSkinnedMesh) skins.add(node.skeleton);
    const geometry = node.geometry;
    triangleCount += Math.floor(
      Math.min(
        geometry.index?.count ?? geometry.attributes.position.count,
        geometry.drawRange.count,
      ) / 3,
    );
    if (!geometries.has(geometry)) {
      geometries.add(geometry);
      vertexCount += geometry.attributes.position.count;
    }
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const [slot, label] of slots)
        if (material[slot]) {
          const texture = material[slot];
          const existing = textures.get(texture.source.uuid);
          if (existing) {
            if (!existing.labels.includes(label)) existing.labels.push(label);
          } else textures.set(texture.source.uuid, { texture, labels: [label] });
        }
    }
  });
  $("vertices").textContent = formatNumber.format(vertexCount);
  $("triangles").textContent = formatNumber.format(triangleCount);
  $("meshes-materials").textContent = `${meshCount} / ${materials.size}`;
  $("textures-count").textContent = textures.size;
  $("animations-info").textContent = `${model.animations.length} / ${skins.size ? "есть" : "нет"}`;
  $("source-size").textContent = sizeLabel(model.file.size);
  $("texture-list").replaceChildren();
  for (const { texture, labels } of [...textures.values()].slice(0, 6)) {
    try {
      const tile = document.createElement("button");
      tile.className = "texture-tile";
      tile.title = `Скачать ${labels.join(" / ")} в PNG`;
      tile.setAttribute("aria-label", tile.title);
      const canvas = textureCanvas(texture, 160),
        caption = document.createElement("span"),
        size = document.createElement("small");
      caption.textContent = labels.join(" / ");
      size.textContent = `${texture.image.width} × ${texture.image.height}`;
      tile.append(canvas, caption, size);
      tile.addEventListener("click", () => {
        textureCanvas(texture).toBlob((blob) => {
          if (blob) download(blob, `${safeName($("export-name").value)}_${labels[0]}.png`);
        }, "image/png");
      });
      $("texture-list").append(tile);
    } catch {
      /* Non-raster texture previews are optional. */
    }
  }
}

function prepareMaterials() {
  originalMaterials = new Map();
  sidedMaterials = new Map();
  model.root.traverse((node) => {
    if (!node.isMesh) return;
    originalMaterials.set(node.uuid, node.material);
    const cloneMaterial = (material) => {
      const clone = material.clone();
      clone.side = THREE.DoubleSide;
      return clone;
    };
    sidedMaterials.set(
      node.uuid,
      Array.isArray(node.material)
        ? node.material.map(cloneMaterial)
        : cloneMaterial(node.material),
    );
    node.frustumCulled = false;
  });
}
function prepareAnimations(play) {
  $("animation-play").checked = play;
  mixer = model.animations.length ? new THREE.AnimationMixer(model.root) : null;
  if (mixer) mixer.timeScale = Number($("animation-speed").value);
  animationAction = null;
  $("animation-section").hidden = !mixer;
  $("animation-select").replaceChildren();
  model.animations.forEach((clip, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = clip.name || `Анимация ${i + 1}`;
    $("animation-select").append(option);
  });
  if (mixer) setAnimation(0);
  syncTransport();
}
function replaceRigRoot(root, animations) {
  mixer?.stopAllAction();
  mixer?.uncacheRoot(model.root);
  restoreOriginalMaterials();
  displayGroup.remove(model.root);
  for (const material of sidedMaterials.values())
    (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
  model.root = root;
  model.animations = animations;
  prepareMaterials();
  displayGroup.add(root);
  displayGroup.updateMatrixWorld(true);
  prepareAnimations(false);
  setMode(currentMode);
  inspectModel();
  updateExportOptions();
  animationEditor?.modelChanged();
}

async function openFiles(files, { onError } = {}) {
  if (busy || rigEditor?.isBusy) return;
  loading(true);
  let next;
  try {
    next = await (typeof files === "function" ? files() : loadFiles(files));
    rigEditor?.clear();
    if (model) {
      mixer?.stopAllAction();
      mixer?.uncacheRoot(model.root);
      restoreOriginalMaterials();
      displayGroup.remove(model.root);
      disposeModel(model.root);
      for (const material of sidedMaterials.values())
        (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
    }
    model = next;
    prepareMaterials();
    const sourceSize = model.bounds.getSize(new THREE.Vector3()),
      center = model.bounds.getCenter(new THREE.Vector3());
    const scale = 1.65 / Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 0.001);
    displayGroup.scale.setScalar(scale);
    displayGroup.position.set(-center.x * scale, -model.bounds.min.y * scale, -center.z * scale);
    displaySize = sourceSize.clone().multiplyScalar(scale);
    displayGroup.add(model.root);
    displayGroup.updateMatrixWorld(true);
    prepareAnimations(true);
    animationEditor?.modelChanged();
    $("file-title").textContent = model.file.name;
    $("file-extension").textContent = model.extension.toUpperCase();
    $("export-name").value = safeName(model.file.name);
    $("empty-state").hidden = true;
    inspectModel();
    resetView();
    updateExportOptions();
    $("export-status").textContent = "";
    toast(`Открыто: ${model.file.name}`);
    return true;
  } catch (error) {
    toast(error.message || "Не удалось открыть модель.", true);
    $("empty-state").hidden = !!model;
    onError?.(error);
    return false;
  } finally {
    loading(false);
    $("file-input").value = "";
  }
}
function openDemo() {
  return openFiles(async () => {
    const response = await globalThis.fetch(demoURL);
    if (!response.ok) throw new Error(`Не удалось загрузить манекен: HTTP ${response.status}.`);
    return loadFiles([
      new File([await response.blob()], "mannequin.glb", { type: "model/gltf-binary" }),
    ]);
  });
}
function setPanel(panel) {
  for (const name of ["view", "rig", "motion", "export"]) {
    const selected = name === panel;
    $(`${name}-panel`).hidden = !selected;
    $(`${name}-tab`).classList.toggle("active", selected);
    $(`${name}-tab`).setAttribute("aria-selected", String(selected));
    $(`${name}-tab`).tabIndex = selected ? 0 : -1;
  }
  $("inspector-title").textContent = {
    view: "Модель",
    rig: "Скелет",
    motion: "Анимации",
    export: "Экспорт",
  }[panel];
  rigEditor?.setActive(panel === "rig");
  document.querySelector(".panel-scroll").scrollTop = 0;
}
function showPanel(panel) {
  setPanel(panel);
  if (window.matchMedia("(max-width: 620px)").matches) $("inspector").classList.add("open");
}
function updateExportOptions() {
  const format = formats.find((f) => f.id === currentFormat);
  $("format-note").textContent = format.note;
  $("export-button").replaceChildren(document.createTextNode(`Экспортировать ${format.name}`));
  const arrow = document.createElement("span");
  arrow.textContent = "↓";
  $("export-button").append(arrow);
  $("texture-size-row").hidden = ["stl", "ply"].includes(currentFormat);
  $("include-animation-row").hidden = !["glb", "gltf"].includes(currentFormat);
  $("include-animations").disabled = !model?.animations.length;
  document.querySelectorAll("[data-format]").forEach((button) => {
    const active = button.dataset.format === currentFormat;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}
for (const format of formats) {
  const button = document.createElement("button");
  button.className = "format-option";
  button.dataset.format = format.id;
  button.setAttribute("role", "radio");
  button.setAttribute("aria-label", `Формат ${format.name}`);
  button.innerHTML = `<span class="radio-dot"></span><span><strong>${format.name}</strong><small>${format.title}</small></span><span class="format-tag">${format.tag}</span>`;
  button.addEventListener("click", () => {
    currentFormat = format.id;
    updateExportOptions();
    $("export-status").textContent = "";
  });
  $("format-options").append(button);
}
updateExportOptions();
$("export-button").addEventListener("click", async () => {
  if (!model || busy || rigEditor?.isBusy) return;
  loading(true, `Подготавливаем ${currentFormat.toUpperCase()}…`);
  $("export-status").textContent = "";
  try {
    rigEditor?.assertExport(currentFormat);
    const name = safeName($("export-name").value);
    const result = await exportModel({
      root: model.root,
      originalMaterials,
      animations: model.animations,
      format: currentFormat,
      name,
      textureSize: Number($("texture-size").value),
      includeAnimations: $("include-animations").checked,
    });
    download(result.data, `${name}.${result.extension}`);
    $("export-status").textContent =
      `Сохранено: ${name}.${result.extension} · ${sizeLabel(result.data.byteLength ?? result.data.length)}`;
    toast("Файл подготовлен и скачан.");
  } catch (error) {
    $("export-status").textContent = `Ошибка: ${error.message}`;
    toast(`Экспорт не выполнен: ${error.message}`, true);
  } finally {
    loading(false);
  }
});

let remoteController = null;
$("url-button").addEventListener("click", () => {
  $("url-status").textContent = "";
  $("url-status").classList.remove("error");
  $("url-dialog").showModal();
});
$("mobile-url-button").addEventListener("click", () => $("url-button").click());
function cancelRemote() {
  if (remoteController)
    remoteController.abort(new DOMException("Загрузка отменена.", "AbortError"));
  else $("url-dialog").close();
}
$("url-cancel").addEventListener("click", cancelRemote);
$("url-dialog").addEventListener("cancel", (event) => {
  if (remoteController) {
    event.preventDefault();
    cancelRemote();
  }
});
$("url-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || remoteController) return;
  remoteController = new AbortController();
  const controller = remoteController;
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Сервер не ответил за 2 минуты. Попробуйте снова.", "TimeoutError"),
      ),
    120000,
  );
  $("url-status").classList.remove("error");
  $("url-status").textContent = "Скачиваем модель…";
  $("url-submit").disabled = true;
  $("model-url").disabled = true;
  $("url-format").disabled = true;
  $("url-cancel").textContent = "Отменить загрузку";
  try {
    const opened = await openFiles(
      async () => {
        const source = await fetchModel($("model-url").value.trim(), {
          format: $("url-format").value,
          signal: controller.signal,
          onProgress: ({ bytes }) => {
            const text = `Скачано ${sizeLabel(bytes)}…`;
            $("url-status").textContent = text;
            $("loading-text").textContent = text;
          },
        });
        clearTimeout(timeout);
        $("url-status").textContent = "Открываем модель…";
        const next = await loadFiles(source.files, source);
        if (controller.signal.aborted) {
          disposeModel(next.root);
          controller.signal.throwIfAborted();
        }
        return next;
      },
      {
        onError: (error) => {
          $("url-status").textContent = controller.signal.aborted
            ? controller.signal.reason.message
            : error.message;
          $("url-status").classList.add("error");
        },
      },
    );
    if (opened) $("url-dialog").close();
  } finally {
    clearTimeout(timeout);
    remoteController = null;
    $("url-submit").disabled = false;
    $("model-url").disabled = false;
    $("url-format").disabled = false;
    $("url-cancel").textContent = "Закрыть";
  }
});

$("open-button").addEventListener("click", () => $("file-input").click());
$("empty-open").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (event) => openFiles(event.target.files));
$("demo-button").addEventListener("click", openDemo);
document.querySelector(".workflow").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll(".workflow [role=tab]")];
  const index = tabs.indexOf(document.activeElement);
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
});
$("view-tab").addEventListener("click", () => showPanel("view"));
$("rig-tab").addEventListener("click", () => showPanel("rig"));
$("motion-tab").addEventListener("click", () => showPanel("motion"));
$("export-tab").addEventListener("click", () => showPanel("export"));
$("export-shortcut").addEventListener("click", () => {
  setPanel("export");
  if (window.matchMedia("(max-width: 620px)").matches) $("inspector").classList.add("open");
});
$("mobile-inspector").addEventListener("click", () => $("inspector").classList.add("open"));
$("close-inspector").addEventListener("click", () => $("inspector").classList.remove("open"));
$("fit-button").addEventListener("click", () => setView(currentView));
$("reset-button").addEventListener("click", resetView);
$("snapshot-button").addEventListener("click", () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    if (blob) download(blob, `${safeName($("export-name").value)}_view.png`);
  }, "image/png");
});
document
  .querySelectorAll("[data-view]")
  .forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document
  .querySelectorAll("[data-mode]")
  .forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
document
  .querySelectorAll("[data-background]")
  .forEach((button) =>
    button.addEventListener("click", () => setBackground(button.dataset.background)),
  );
$("background-color").addEventListener("input", (event) => setBackground(event.target.value));
$("double-sided").addEventListener("change", () => setMode(currentMode));
$("auto-rotate").addEventListener("change", (event) => {
  controls.autoRotate = event.target.checked;
});
$("grid-toggle").addEventListener("change", (event) => {
  grid.visible = event.target.checked;
});
$("axes-toggle").addEventListener("change", (event) => {
  axes.visible = event.target.checked;
});
for (const [id, setter] of [
  [
    "exposure",
    (value) => {
      renderer.toneMappingExposure = value;
    },
  ],
  [
    "environment",
    (value) => {
      scene.environmentIntensity = value;
    },
  ],
  [
    "light",
    (value) => {
      keyLight.intensity = value;
    },
  ],
]) {
  $(id).addEventListener("input", (event) => {
    const value = Number(event.target.value);
    setter(value);
    $(`${id}-value`).textContent = value.toFixed(1);
  });
}
$("animation-select").addEventListener("change", (event) =>
  setAnimation(Number(event.target.value)),
);
$("animation-play").addEventListener("change", (event) => {
  if (animationAction) animationAction.paused = !event.target.checked;
  else if (event.target.checked) setAnimation(Number($("animation-select").value));
});
$("animation-speed").addEventListener("input", (event) => {
  if (mixer) mixer.timeScale = Number(event.target.value);
  $("animation-speed-value").textContent = `${Number(event.target.value).toFixed(1)}×`;
});
$("animation-loop").addEventListener("change", () =>
  setAnimation(Number($("animation-select").value)),
);
$("animation-rest").addEventListener("click", () => {
  mixer?.stopAllAction();
  animationAction = null;
  $("animation-play").checked = false;
  rigEditor?.prepareAnimation();
  syncTransport();
});
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    $("drop-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("drop-overlay").hidden = true;
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (event.dataTransfer.files.length) openFiles(event.dataTransfer.files);
});
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input,select,textarea")) return;
  if (event.target.closest("dialog") || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === "Space" && !event.target.matches("button")) {
    event.preventDefault();
    togglePlayback();
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    seek(
      frameTime(
        animationAction?.time ?? 0,
        event.key === "ArrowLeft" ? -1 : 1,
        animationAction?.getClip().duration ?? 0,
      ),
    );
  }
  if (event.key.toLowerCase() === "f") setView(currentView);
  if (event.key === "Escape") $("inspector").classList.remove("open");
});
const resize = () => {
  const width = viewport.clientWidth,
    height = viewport.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
new ResizeObserver(() => {
  resize();
  setView(currentView);
}).observe(viewport);
new ResizeObserver(() => {
  document
    .querySelector(".workspace")
    .style.setProperty("--transport-height", `${$("transport-root").clientHeight}px`);
}).observe($("transport-root"));
resize();
setView();
let lastFrame = performance.now();
renderer.setAnimationLoop((time) => {
  const delta = Math.min((time - lastFrame) / 1000, 0.05);
  lastFrame = time;
  if (!busy) mixer?.update(Math.max(0, delta));
  if (time - lastTransportFrame >= 100) {
    lastTransportFrame = time;
    if (animationAction?.paused) $("animation-play").checked = false;
    syncTransport();
  }
  rigEditor?.update();
  controls.update();
  renderer.render(scene, camera);
});
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  toast("Браузер потерял графический контекст. Перезагрузите страницу.", true);
});
rigEditor = createRigEditor({
  scene,
  displayGroup,
  camera,
  canvas: renderer.domElement,
  orbit: controls,
  getModel: () => model,
  getMaterials: () => originalMaterials,
  replaceRoot: replaceRigRoot,
  onBusy: (value) => loading(value, "Привязываем модель…"),
  message: toast,
  stopAnimation: () => {
    mixer?.stopAllAction();
    animationAction = null;
    $("animation-play").checked = false;
  },
});
animationEditor = createAnimationEditor({
  getModel: () => model,
  loading,
  message: toast,
  beforeApply: () => {
    rigEditor.assertExport("glb");
    rigEditor.prepareAnimation();
  },
  addClip: (clip) => {
    mixer?.stopAllAction();
    mixer?.uncacheRoot(model.root);
    const existing = model.animations.findIndex((c) => c.name === clip.name);
    if (existing >= 0) model.animations[existing] = clip;
    else model.animations.push(clip);
    prepareAnimations(true);
    setAnimation(existing >= 0 ? existing : model.animations.length - 1);
    inspectModel();
    updateExportOptions();
  },
});
setPanel("view");
await openDemo();
