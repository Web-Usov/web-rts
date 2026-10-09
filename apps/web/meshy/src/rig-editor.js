import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  JOINTS,
  bindHumanoid,
  copyLayout,
  disposeRig,
  fitHumanoid,
  moveJoint,
  poseRig,
} from "./rigging.ts";

export function createRigEditor({
  scene,
  displayGroup,
  camera,
  canvas,
  orbit,
  getModel,
  getMaterials,
  replaceRoot,
  stopAnimation,
  onBusy,
  message,
}) {
  const $ = (id) => document.getElementById(id);
  const transform = new TransformControls(camera, canvas);
  transform.setMode("translate");
  transform.setSpace("world");
  transform.setSize(0.7);
  scene.add(transform.getHelper());
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let source = null,
    draft = null,
    binding = null,
    overlay = null,
    lines = null;
  let active = false,
    busy = false,
    selected = "Hips",
    posing = false;
  let undo = [],
    redo = [],
    dragBefore = null;
  const markers = new Map();
  let markerGeometry, markerMaterial, selectedMaterial;
  const status = (text) => {
    $("rig-status").textContent = text;
  };

  for (const [name, label] of JOINTS) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = label;
    $("rig-joint").append(option);
  }
  function controlsState() {
    $("rig-create").hidden = !!draft;
    $("rig-tools").hidden = !draft;
    $("rig-create").disabled = busy || !getModel();
    $("rig-bind").disabled = busy || !draft;
    $("rig-undo").disabled = busy || !undo.length;
    $("rig-redo").disabled = busy || !redo.length;
    $("rig-elbows").disabled = busy || !binding;
    $("rig-knees").disabled = busy || !binding;
    $("rig-rest").disabled = busy || !binding;
    for (const id of [
      "rig-x",
      "rig-y",
      "rig-z",
      "rig-joint",
      "rig-reset",
      "rig-delete",
      "rig-softness",
      "rig-symmetry",
      "rig-forward",
    ])
      $(id).disabled = busy;
    if (overlay) overlay.visible = active && $("rig-show").checked;
    transform.enabled = !busy && active && !!draft && !posing && $("rig-show").checked;
    if (transform.enabled) transform.attach(markers.get(selected));
    else transform.detach();
  }
  function coordinateFields() {
    if (!draft) return;
    const point = draft.layout[selected];
    for (const axis of ["x", "y", "z"]) {
      $(`rig-${axis}`).value = Number(point[axis].toPrecision(6));
      $(`rig-${axis}`).step = draft.height / 200;
    }
    $("rig-joint").value = selected;
    markers.forEach((marker, name) => {
      marker.material = name === selected ? selectedMaterial : markerMaterial;
      marker.scale.setScalar(name === selected ? 1.35 : 1);
    });
  }
  function select(name) {
    selected = name;
    coordinateFields();
    controlsState();
  }
  function resetPose() {
    stopAnimation();
    posing = false;
    $("rig-elbows").value = 0;
    $("rig-knees").value = 0;
    $("rig-elbows-value").textContent = "0°";
    $("rig-knees-value").textContent = "0°";
    if (binding) poseRig(binding, 0, 0, draft.forward);
    controlsState();
  }
  function releaseBinding() {
    resetPose();
    if (binding) {
      replaceRoot(source.root, source.animations);
      disposeRig(binding);
      binding = null;
    }
  }
  function remember(before) {
    undo.push(before);
    if (undo.length > 50) undo.shift();
    redo = [];
    controlsState();
  }
  function changed() {
    releaseBinding();
    coordinateFields();
    update();
    controlsState();
    status("Подгонка изменена. Нажмите «Привязать модель», чтобы пересчитать веса.");
  }
  function clear() {
    releaseBinding();
    transform.detach();
    orbit.enabled = true;
    if (overlay) {
      displayGroup.remove(overlay);
      lines.geometry.dispose();
      lines.material.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      selectedMaterial.dispose();
    }
    source = null;
    draft = null;
    overlay = null;
    lines = null;
    markers.clear();
    undo = [];
    redo = [];
    status("");
    controlsState();
  }
  function buildOverlay() {
    overlay = new THREE.Group();
    overlay.name = "RigEditorOverlay";
    overlay.position.copy(source.root.position);
    overlay.quaternion.copy(source.root.quaternion);
    overlay.scale.copy(source.root.scale);
    markerGeometry = new THREE.SphereGeometry(draft.height * 0.009, 12, 8);
    markerMaterial = new THREE.MeshBasicMaterial({ color: 0x87b5a4, depthTest: false });
    selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xe5ffe9, depthTest: false });
    for (const [name] of JOINTS) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.name = name;
      marker.renderOrder = 1002;
      marker.position.copy(draft.layout[name]);
      overlay.add(marker);
      markers.set(name, marker);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array((JOINTS.length - 1) * 6), 3),
    );
    lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xbde4cd,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    lines.renderOrder = 1001;
    lines.frustumCulled = false;
    overlay.add(lines);
    displayGroup.add(overlay);
    update();
    coordinateFields();
    controlsState();
  }
  function update() {
    if (!overlay || !draft) return;
    overlay.updateWorldMatrix(true, false);
    if (binding) {
      binding.root.updateWorldMatrix(true, true);
      binding.skeleton.update();
      const point = new THREE.Vector3();
      markers.forEach((marker, name) => {
        binding.bones[name].getWorldPosition(point);
        marker.position.copy(overlay.worldToLocal(point));
      });
    } else if (!transform.dragging)
      markers.forEach((marker, name) => marker.position.copy(draft.layout[name]));
    const positions = lines.geometry.getAttribute("position");
    let index = 0;
    JOINTS.forEach(([name, , parent]) => {
      if (!parent) return;
      for (const id of [parent, name]) {
        const p = markers.get(id).position;
        positions.setXYZ(index++, p.x, p.y, p.z);
      }
    });
    positions.needsUpdate = true;
  }
  function fail(error) {
    status(error.message);
    message(error.message, true);
  }
  $("rig-create").addEventListener("click", () => {
    if (busy) return;
    try {
      const model = getModel();
      if (!model) return;
      if (model.animations.length)
        throw new Error(
          "Откройте статическую модель без существующих анимаций для создания автоскелета.",
        );
      const fitted = fitHumanoid(model.root, Number($("rig-forward").value));
      source = {
        root: model.root,
        animations: model.animations,
        materials: new Map(getMaterials()),
      };
      draft = fitted;
      undo = [];
      redo = [];
      selected = "Hips";
      orbit.autoRotate = false;
      $("auto-rotate").checked = false;
      buildOverlay();
      status(
        "22 сустава. Проверьте положение плеч, локтей, коленей и стоп; затем привяжите модель.",
      );
    } catch (error) {
      fail(error);
    }
  });
  $("rig-joint").addEventListener("change", (event) => select(event.target.value));
  for (const axis of ["x", "y", "z"])
    $(`rig-${axis}`).addEventListener("change", () => {
      if (!draft || busy) return;
      const before = copyLayout(draft.layout),
        point = draft.layout[selected].clone();
      point[axis] = $(`rig-${axis}`).value.trim() ? Number($(`rig-${axis}`).value) : NaN;
      try {
        moveJoint(draft, selected, point, $("rig-symmetry").checked);
        remember(before);
        changed();
      } catch (error) {
        coordinateFields();
        fail(error);
      }
    });
  transform.addEventListener("dragging-changed", (event) => {
    orbit.enabled = !event.value;
    if (event.value) {
      dragBefore = copyLayout(draft.layout);
      releaseBinding();
    } else if (dragBefore) {
      const modified = JOINTS.some(([name]) => !draft.layout[name].equals(dragBefore[name]));
      if (modified) remember(dragBefore);
      dragBefore = null;
      coordinateFields();
    }
  });
  transform.addEventListener("objectChange", () => {
    if (!draft || busy) return;
    try {
      moveJoint(draft, selected, transform.object.position, $("rig-symmetry").checked);
      // Keep the attached marker intact while synchronizing its symmetric partner.
      markers.forEach((marker, name) => {
        if (name !== selected) marker.position.copy(draft.layout[name]);
      });
      coordinateFields();
      update();
      status("Подгонка изменена. Пересчитайте привязку модели.");
    } catch (error) {
      transform.object.position.copy(draft.layout[selected]);
      fail(error);
    }
  });
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !active ||
        busy ||
        !draft ||
        posing ||
        !$("rig-show").checked ||
        transform.axis ||
        event.button !== 0
      )
        return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
      raycaster.setFromCamera(pointer, camera);
      overlay.updateWorldMatrix(true, true);
      const hit = raycaster.intersectObjects([...markers.values()])[0];
      if (hit) {
        event.preventDefault();
        event.stopImmediatePropagation();
        select(hit.object.name);
      }
    },
    true,
  );
  $("rig-undo").addEventListener("click", () => {
    if (!undo.length || busy) return;
    redo.push(copyLayout(draft.layout));
    draft.layout = undo.pop();
    changed();
  });
  $("rig-redo").addEventListener("click", () => {
    if (!redo.length || busy) return;
    undo.push(copyLayout(draft.layout));
    draft.layout = redo.pop();
    changed();
  });
  $("rig-reset").addEventListener("click", () => {
    if (!draft || busy) return;
    try {
      const next = fitHumanoid(source.root, Number($("rig-forward").value));
      remember(copyLayout(draft.layout));
      draft = next;
      changed();
    } catch (error) {
      fail(error);
    }
  });
  $("rig-forward").addEventListener("change", () => {
    if (draft) {
      draft.forward = Number($("rig-forward").value);
      changed();
    }
  });
  $("rig-delete").addEventListener("click", clear);
  $("rig-softness").addEventListener("input", () => {
    $("rig-softness-value").textContent = Number($("rig-softness").value).toFixed(1);
  });
  $("rig-softness").addEventListener("change", () => {
    if (draft) changed();
  });
  $("rig-show").addEventListener("change", controlsState);
  $("rig-bind").addEventListener("click", async () => {
    if (!draft || busy) return;
    busy = true;
    onBusy(true);
    controlsState();
    status("Вычисляем привязку…");
    // Let the browser paint the status before bounded geometry processing.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const next = bindHumanoid(
        source.root,
        draft,
        source.materials,
        Number($("rig-softness").value),
      );
      releaseBinding();
      binding = next;
      replaceRoot(binding.root, binding.animations);
      resetPose();
      status(
        "Модель привязана: 22 кости, 2 тестовых клипа. Проверьте сгибы или экспортируйте GLB/glTF.",
      );
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
      onBusy(false);
      controlsState();
      update();
    }
  });
  function pose() {
    if (!binding || busy) return;
    stopAnimation();
    const elbows = Number($("rig-elbows").value),
      knees = Number($("rig-knees").value);
    posing = !!(elbows || knees);
    $("rig-elbows-value").textContent = `${elbows}°`;
    $("rig-knees-value").textContent = `${knees}°`;
    poseRig(
      binding,
      THREE.MathUtils.degToRad(elbows),
      THREE.MathUtils.degToRad(knees),
      draft.forward,
    );
    controlsState();
    update();
  }
  $("rig-elbows").addEventListener("input", pose);
  $("rig-knees").addEventListener("input", pose);
  $("rig-rest").addEventListener("click", resetPose);
  controlsState();
  return {
    clear,
    update,
    setActive(value) {
      active = value;
      if (value && draft) resetPose();
      controlsState();
    },
    setBusy(value) {
      busy = value;
      controlsState();
    },
    get isBusy() {
      return busy;
    },
    assertExport(format) {
      if (draft && !binding && ["glb", "gltf"].includes(format))
        throw new Error("Скелет ещё не привязан. Нажмите «Привязать модель» во вкладке «Скелет».");
    },
  };
}
