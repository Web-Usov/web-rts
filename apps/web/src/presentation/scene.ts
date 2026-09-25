import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { GameCommand, GameTransport } from "@web-rts/protocol";
import type { ClientGameState } from "../client/client-game-state.js";
import type { InterpolatedPose } from "../client/interpolation.js";
import {
  RTS_CAMERA_ALPHA,
  RTS_CAMERA_BETA,
  RTS_CAMERA_MAX_RADIUS,
  RTS_CAMERA_MIN_RADIUS,
  RTS_MAP_HALF_EXTENT,
  createRtsCameraPose,
  panRtsCamera,
  screenDragToGround,
  zoomRtsCamera,
  type RtsCameraPose,
} from "./camera.js";
import {
  babylonToSimulationGround,
  simulationToBabylonGround,
  simulationToBabylonPosition,
} from "./coordinates.js";
import { PresentationState } from "./state.js";
import type { HudView, PresentationEntity, PresentationSyncData } from "./types.js";

const PALETTE = ["#3d8bfd", "#e15a45", "#e6c34a", "#3cba6e"] as const;
const DRAG_THRESHOLD_PX = 4;
const UNIT_HEIGHT = 0.6;

interface EntityVisual {
  mesh: AbstractMesh;
}

export interface PresentationSession {
  dispose(): void;
}

export type PresentationBindings = {
  transport: GameTransport;
  clientState: ClientGameState;
  /** Issues MOVE for the currently selected local unit. */
  nextCommandId: () => string;
};

/**
 * Babylon scene is a view of PresentationState fed by ClientGameState.
 * It does not own gameplay rules, time, or authority.
 * WebGL Engine is required so build and CI do not depend on WebGPU.
 */
export function mountPresentation(
  canvas: HTMLCanvasElement,
  onHud: (view: HudView) => void,
  bindings: PresentationBindings,
  onFps?: (fps: number) => void,
): PresentationSession {
  const engine = new Engine(canvas, true, { stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor.set(0.07, 0.09, 0.12, 1);

  const poseHolder = { current: createRtsCameraPose() };
  const camera = new ArcRotateCamera(
    "rts-camera",
    RTS_CAMERA_ALPHA,
    RTS_CAMERA_BETA,
    poseHolder.current.radius,
    new Vector3(0, 0, 0),
    scene,
  );
  lockIsometricCamera(camera);
  applyPose(camera, poseHolder.current);

  const light = new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
  light.intensity = 0.95;

  const mapSize = RTS_MAP_HALF_EXTENT * 2;
  const terrain = MeshBuilder.CreateGround("terrain", { width: mapSize, height: mapSize }, scene);
  const terrainMaterial = new StandardMaterial("terrain-material", scene);
  terrainMaterial.diffuseColor = new Color3(0.16, 0.22, 0.18);
  terrainMaterial.specularColor = Color3.Black();
  terrain.material = terrainMaterial;
  terrain.metadata = { role: "ground" };
  terrain.isPickable = true;

  const grid = createGrid(scene);

  const selection = MeshBuilder.CreateTorus(
    "selection",
    { diameter: 1.8, thickness: 0.08, tessellation: 24 },
    scene,
  );
  const selectionMaterial = new StandardMaterial("selection-material", scene);
  selectionMaterial.emissiveColor = new Color3(0.95, 0.95, 0.85);
  selection.material = selectionMaterial;
  selection.isPickable = false;
  selection.setEnabled(false);

  const destination = MeshBuilder.CreateCylinder(
    "destination",
    { diameter: 0.7, height: 0.08, tessellation: 16 },
    scene,
  );
  const destinationMaterial = new StandardMaterial("destination-material", scene);
  destinationMaterial.emissiveColor = new Color3(0.95, 0.55, 0.2);
  destination.material = destinationMaterial;
  destination.isPickable = false;
  destination.setEnabled(false);

  const presentation = new PresentationState();
  const visuals = new Map<number, EntityVisual>();
  const materials = new Map<number, StandardMaterial>();
  const unsubscribeHud = presentation.subscribe(onHud);

  let clientSequence = 0;

  const syncVisuals = (): void => {
    const alive = new Set<number>();
    for (const entity of presentation.getEntities()) {
      alive.add(entity.id);
      const visual = visuals.get(entity.id) ?? createVisual(scene, entity, materials);
      visuals.set(entity.id, visual);
      visual.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
      visual.mesh.material = materialFor(scene, materials, entity.colorSlot);
    }

    for (const [id, visual] of visuals) {
      if (!alive.has(id)) {
        visual.mesh.dispose();
        visuals.delete(id);
      }
    }

    const selectedId = presentation.getSelectedIds()[0];
    const selected = selectedId === undefined ? undefined : presentation.getEntity(selectedId);
    if (selected) {
      selection.position.set(selected.position.x, 0.05, selected.position.z);
      selection.setEnabled(true);
    } else {
      selection.setEnabled(false);
    }

    const marker = presentation.getDestination();
    if (marker) {
      destination.position.set(marker.x, 0.05, marker.z);
      destination.setEnabled(true);
    } else {
      destination.setEnabled(false);
    }
  };

  const pushPresentation = (poses: readonly InterpolatedPose[]): void => {
    const sync: PresentationSyncData = {
      entities: poses.map((pose) => poseToPresentation(pose)),
      selectedIds: [...bindings.clientState.getSelectedIds()],
      destination: (() => {
        const marker = bindings.clientState.getDestinationMarker();
        return marker ? simulationToBabylonGround(marker) : null;
      })(),
    };
    presentation.apply(sync);
    syncVisuals();
  };

  const unsubscribeState = bindings.clientState.subscribeState((poses) => {
    pushPresentation(poses);
  });

  scene.activeCamera = camera;
  syncVisuals();

  let dragging = false;
  let dragButton = -1;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;

  const updateInterpolatedMeshes = (poses: readonly InterpolatedPose[]): void => {
    for (const pose of poses) {
      let visual = visuals.get(pose.entityId);
      if (!visual) {
        const entity = poseToPresentation(pose);
        visual = createVisual(scene, entity, materials);
        visuals.set(pose.entityId, visual);
      }
      const position = simulationToBabylonPosition({ x: pose.x, y: pose.y }, UNIT_HEIGHT);
      visual.mesh.position.set(position.x, position.y, position.z);
    }

    const selectedId = bindings.clientState.getSelectedIds()[0];
    const selectedPose =
      selectedId === undefined ? undefined : poses.find((pose) => pose.entityId === selectedId);
    if (selectedPose) {
      const position = simulationToBabylonPosition(
        { x: selectedPose.x, y: selectedPose.y },
        UNIT_HEIGHT,
      );
      selection.position.set(position.x, 0.05, position.z);
      selection.setEnabled(true);
    } else {
      selection.setEnabled(false);
    }

    const marker = bindings.clientState.getDestinationMarker();
    if (marker) {
      const ground = simulationToBabylonGround(marker);
      destination.position.set(ground.x, 0.05, ground.z);
      destination.setEnabled(true);
    } else {
      destination.setEnabled(false);
    }
  };

  const pointerObserver = scene.onPointerObservable.add((info) => {
    const event = info.event;

    if (info.type === PointerEventTypes.POINTERWHEEL && hasDeltaY(event)) {
      const delta = event.deltaY > 0 ? 1.5 : -1.5;
      poseHolder.current = zoomRtsCamera(poseHolder.current, delta);
      applyPose(camera, poseHolder.current);
      return;
    }

    if (info.type === PointerEventTypes.POINTERDOWN) {
      dragging = true;
      dragButton = event.button;
      lastX = scene.pointerX;
      lastY = scene.pointerY;
      dragDistance = 0;
      return;
    }

    if (
      info.type === PointerEventTypes.POINTERMOVE &&
      dragging &&
      (dragButton === 1 || dragButton === 2)
    ) {
      const screenDx = scene.pointerX - lastX;
      const screenDy = scene.pointerY - lastY;
      lastX = scene.pointerX;
      lastY = scene.pointerY;
      dragDistance += Math.abs(screenDx) + Math.abs(screenDy);
      const ground = screenDragToGround(screenDx, screenDy, poseHolder.current.radius);
      poseHolder.current = panRtsCamera(poseHolder.current, ground.x, ground.z);
      applyPose(camera, poseHolder.current);
      return;
    }

    if (info.type !== PointerEventTypes.POINTERUP) {
      return;
    }

    const button = dragButton;
    const moved = dragDistance;
    dragging = false;
    dragButton = -1;

    if (button === 0 && moved < DRAG_THRESHOLD_PX) {
      const pick = info.pickInfo;
      const id = presentationId(pick?.pickedMesh ?? null);
      const localUnitId = bindings.clientState.getLocalUnitEntityId();
      // Selection is an action; only the local bound unit is selectable in F5.
      if (id !== null && id === localUnitId) {
        bindings.clientState.select(id);
      } else {
        bindings.clientState.select(null);
      }
      pushPresentation(bindings.clientState.sample(performance.now()));
      return;
    }

    if (button === 2 && moved < DRAG_THRESHOLD_PX) {
      const pick = info.pickInfo;
      const point = pick?.pickedPoint;
      const role = meshRole(pick?.pickedMesh ?? null);
      if (point && role === "ground") {
        const entityId = bindings.clientState.getCommandEntityId();
        if (entityId === null) {
          return;
        }
        const simTarget = babylonToSimulationGround({ x: point.x, z: point.z });
        // Destination marker = instant UX feedback (game-feel), not authority.
        bindings.clientState.setDestinationMarker(simTarget);
        pushPresentation(bindings.clientState.sample(performance.now()));
        clientSequence += 1;
        const command: GameCommand = {
          type: "MOVE",
          commandId: bindings.nextCommandId(),
          clientSequence,
          entityIds: [entityId],
          target: simTarget,
        };
        bindings.transport.sendCommand(command);
      }
    }
  });

  const onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
  canvas.addEventListener("contextmenu", onContextMenu);

  let fpsStamp = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    bindings.clientState.setRenderTimeMs(now);
    updateInterpolatedMeshes(bindings.clientState.sample(now));
    if (onFps && now - fpsStamp >= 250) {
      fpsStamp = now;
      onFps(Math.round(engine.getFps()));
    }
    scene.render();
  });

  const onResize = (): void => {
    engine.resize();
  };
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      unsubscribeHud();
      unsubscribeState();
      scene.onPointerObservable.remove(pointerObserver);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("resize", onResize);
      engine.stopRenderLoop();
      grid.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

function poseToPresentation(pose: InterpolatedPose): PresentationEntity {
  const colorSlot =
    pose.controllerPlayerId !== null && pose.controllerPlayerId >= 0 ? pose.controllerPlayerId : 0;
  return {
    id: pose.entityId,
    kind: pose.kind,
    position: simulationToBabylonPosition({ x: pose.x, y: pose.y }, UNIT_HEIGHT),
    colorSlot,
  };
}

function lockIsometricCamera(camera: ArcRotateCamera): void {
  camera.lowerAlphaLimit = RTS_CAMERA_ALPHA;
  camera.upperAlphaLimit = RTS_CAMERA_ALPHA;
  camera.lowerBetaLimit = RTS_CAMERA_BETA;
  camera.upperBetaLimit = RTS_CAMERA_BETA;
  camera.lowerRadiusLimit = RTS_CAMERA_MIN_RADIUS;
  camera.upperRadiusLimit = RTS_CAMERA_MAX_RADIUS;
  camera.panningSensibility = 0;
  camera.wheelPrecision = 50;
}

function applyPose(camera: ArcRotateCamera, pose: RtsCameraPose): void {
  camera.alpha = RTS_CAMERA_ALPHA;
  camera.beta = RTS_CAMERA_BETA;
  camera.radius = pose.radius;
  camera.target.x = pose.targetX;
  camera.target.y = 0;
  camera.target.z = pose.targetZ;
}

function createGrid(scene: Scene): LinesMesh {
  const lines: Vector3[][] = [];
  const half = RTS_MAP_HALF_EXTENT;
  for (let offset = -half; offset <= half; offset += 2) {
    lines.push([new Vector3(offset, 0.02, -half), new Vector3(offset, 0.02, half)]);
    lines.push([new Vector3(-half, 0.02, offset), new Vector3(half, 0.02, offset)]);
  }

  const grid = MeshBuilder.CreateLineSystem("grid", { lines }, scene);
  grid.color = new Color3(0.35, 0.45, 0.38);
  grid.isPickable = false;
  return grid;
}

function createVisual(
  scene: Scene,
  entity: PresentationEntity,
  materials: Map<number, StandardMaterial>,
): EntityVisual {
  const mesh =
    entity.kind === "objective"
      ? MeshBuilder.CreateCylinder(
          `objective-${entity.id}`,
          { diameterTop: 0.2, diameterBottom: 1.4, height: 2.2, tessellation: 5 },
          scene,
        )
      : MeshBuilder.CreateBox(`unit-${entity.id}`, { size: 1.1 }, scene);

  mesh.metadata = { presentationId: entity.id };
  mesh.isPickable = true;
  mesh.material = materialFor(scene, materials, entity.colorSlot);
  return { mesh };
}

function materialFor(
  scene: Scene,
  materials: Map<number, StandardMaterial>,
  colorSlot: number,
): StandardMaterial {
  const cached = materials.get(colorSlot);
  if (cached) {
    return cached;
  }

  const material = new StandardMaterial(`slot-${colorSlot}`, scene);
  material.diffuseColor = Color3.FromHexString(PALETTE[colorSlot % PALETTE.length] ?? PALETTE[0]);
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  materials.set(colorSlot, material);
  return material;
}

function hasDeltaY(event: object): event is { deltaY: number } {
  return "deltaY" in event && typeof event.deltaY === "number";
}

function presentationId(mesh: AbstractMesh | null): number | null {
  const metadata: unknown = mesh?.metadata;
  if (!metadata || typeof metadata !== "object" || !("presentationId" in metadata)) {
    return null;
  }

  const id = metadata.presentationId;
  return typeof id === "number" ? id : null;
}

function meshRole(mesh: AbstractMesh | null): string | null {
  const metadata: unknown = mesh?.metadata;
  if (!metadata || typeof metadata !== "object" || !("role" in metadata)) {
    return null;
  }

  const role = metadata.role;
  return typeof role === "string" ? role : null;
}
