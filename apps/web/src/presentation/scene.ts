import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { GameCommand, GameTransport } from "@web-rts/protocol";
import type { ClientGameState } from "../client/client-game-state.js";
import type { InterpolatedPose } from "../client/interpolation.js";
import {
  RTS_CAMERA_ALPHA,
  RTS_CAMERA_BETA,
  RtsCameraController,
  type RtsCameraPose,
} from "./camera.js";
import { bindCameraInput } from "./camera-input.js";
import {
  babylonToSimulationGround,
  simulationToBabylonGround,
  simulationToBabylonPosition,
} from "./coordinates.js";
import { ownerColorSlot } from "./entity-color.js";
import { PRESENTED_MAP, mapGroundExtent, type GroundExtent } from "./map-layout.js";
import {
  EMPTY_RENDERER_DEBUG_SAMPLE,
  snapshotRendererDebugSample,
  type RendererDebugSample,
} from "./renderer-debug.js";
import { PresentationState } from "./state.js";
import type { HudView, PresentationEntity, PresentationSyncData } from "./types.js";

const PALETTE = ["#3d8bfd", "#e15a45", "#e6c34a", "#3cba6e"] as const;
const UNIT_HEIGHT = 0.6;
const OBJECTIVE_HEIGHT = 2.2;

interface EntityVisual {
  mesh: AbstractMesh;
}

export interface PresentationSession {
  dispose(): void;
  readRendererDebugSample(): RendererDebugSample;
  setEdgeScrolling(enabled: boolean): void;
  /** Development-only. Production builds no-op without loading the Inspector package. */
  showInspector(): Promise<void>;
}

export type PresentationOptions = {
  /** When false, SceneInstrumentation is not created. Production passes false. */
  instrumentRenderer?: boolean;
};

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
  options?: PresentationOptions,
): PresentationSession {
  const engine = new Engine(canvas, true, { stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor.set(0.07, 0.09, 0.12, 1);
  let instrumentation: SceneInstrumentation | null = null;
  if (import.meta.env.DEV && options?.instrumentRenderer === true) {
    instrumentation = new SceneInstrumentation(scene);
    instrumentation.captureFrameTime = true;
  }
  const instrumentRenderer = instrumentation !== null;
  let rendererSample: RendererDebugSample = EMPTY_RENDERER_DEBUG_SAMPLE;
  let inspectorToken: { dispose(): Promise<void>; isDisposed: boolean } | null = null;

  const extent = mapGroundExtent(PRESENTED_MAP);
  const controller = new RtsCameraController(extent);
  const camera = new ArcRotateCamera(
    "rts-camera",
    RTS_CAMERA_ALPHA,
    RTS_CAMERA_BETA,
    controller.pose.radius,
    new Vector3(0, 0, 0),
    scene,
  );
  camera.inputs.clear();
  applyPose(camera, controller.pose);

  const light = new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
  light.intensity = 0.95;

  const terrain = MeshBuilder.CreateGround(
    "terrain",
    { width: extent.maxX - extent.minX, height: extent.maxZ - extent.minZ },
    scene,
  );
  terrain.position.set((extent.minX + extent.maxX) / 2, 0, (extent.minZ + extent.maxZ) / 2);
  const terrainMaterial = new StandardMaterial("terrain-material", scene);
  terrainMaterial.diffuseColor = new Color3(0.16, 0.22, 0.18);
  terrainMaterial.specularColor = Color3.Black();
  terrain.material = terrainMaterial;
  terrain.metadata = { role: "ground" };
  terrain.isPickable = true;

  const grid = createGrid(scene, extent);

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

  const objectiveMaterial = new StandardMaterial("objective-material", scene);
  objectiveMaterial.diffuseColor = new Color3(0.72, 0.55, 0.95);
  objectiveMaterial.emissiveColor = new Color3(0.35, 0.18, 0.55);
  objectiveMaterial.specularColor = Color3.Black();

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
      visual.mesh.material =
        entity.kind === "OBJECTIVE"
          ? objectiveMaterial
          : materialFor(scene, materials, entity.colorSlot);
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

  const updateInterpolatedMeshes = (poses: readonly InterpolatedPose[]): void => {
    for (const pose of poses) {
      let visual = visuals.get(pose.entityId);
      if (!visual) {
        const entity = poseToPresentation(pose);
        visual = createVisual(scene, entity, materials);
        visuals.set(pose.entityId, visual);
        visual.mesh.material =
          entity.kind === "OBJECTIVE"
            ? objectiveMaterial
            : materialFor(scene, materials, entity.colorSlot);
      }
      const height = pose.kind === "OBJECTIVE" ? OBJECTIVE_HEIGHT / 2 : UNIT_HEIGHT;
      const position = simulationToBabylonPosition({ x: pose.x, y: pose.y }, height);
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

  const cameraInput = bindCameraInput(
    canvas,
    controller,
    () => ({
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight),
      fov: camera.fov,
    }),
    () => bindings.clientState.getView()?.phase === "RUNNING",
    (button, point) => {
      if (button === 0) {
        const pick = scene.pick(point.x, point.y);
        const id = presentationId(pick?.pickedMesh ?? null);
        if (id !== null && bindings.clientState.canLocalPlayerControl(id)) {
          bindings.clientState.select(id);
        } else {
          bindings.clientState.select(null);
        }
        pushPresentation(bindings.clientState.sample(performance.now()));
        return;
      }

      if (button === 2) {
        const pick = scene.pick(point.x, point.y);
        const pickedPoint = pick?.pickedPoint;
        const role = meshRole(pick?.pickedMesh ?? null);
        if (pickedPoint && role === "ground") {
          const entityId = bindings.clientState.getCommandEntityId();
          if (entityId === null) {
            return;
          }
          const simTarget = babylonToSimulationGround({ x: pickedPoint.x, z: pickedPoint.z });
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
    },
  );

  let fpsStamp = performance.now();
  let cameraStamp = fpsStamp;
  engine.runRenderLoop(() => {
    const now = performance.now();
    applyPose(camera, cameraInput.step(Math.min(0.1, (now - cameraStamp) / 1000)));
    cameraStamp = now;
    bindings.clientState.setRenderTimeMs(now);
    updateInterpolatedMeshes(bindings.clientState.sample(now));
    if (onFps && now - fpsStamp >= 250) {
      fpsStamp = now;
      onFps(Math.round(engine.getFps()));
    }
    scene.render();
    if (instrumentRenderer) {
      rendererSample = snapshotRendererDebugSample({
        fps: engine.getFps(),
        drawCalls: instrumentation?.drawCallsCounter.current ?? 0,
        activeMeshes: scene.getActiveMeshes().length,
        frameTimeMs: instrumentation?.frameTimeCounter.current ?? 0,
      });
    }
  });

  const onResize = (): void => {
    engine.resize();
  };
  window.addEventListener("resize", onResize);

  return {
    setEdgeScrolling(enabled) {
      cameraInput.setEdgeEnabled(enabled);
    },
    readRendererDebugSample() {
      return rendererSample;
    },
    async showInspector() {
      if (!import.meta.env.DEV) {
        return;
      }
      if (inspectorToken && !inspectorToken.isDisposed) {
        return;
      }
      const { ShowInspector } = await import("@babylonjs/inspector");
      inspectorToken = ShowInspector(scene, {
        layoutMode: "overlay",
        autoResizeEngine: false,
      });
    },
    dispose() {
      unsubscribeHud();
      unsubscribeState();
      cameraInput.dispose();
      window.removeEventListener("resize", onResize);
      engine.stopRenderLoop();
      const token = inspectorToken;
      inspectorToken = null;
      void token?.dispose();
      instrumentation?.dispose();
      grid.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

function poseToPresentation(pose: InterpolatedPose): PresentationEntity {
  const colorSlot = ownerColorSlot(pose.kind, pose.ownerPlayerId);
  const height = pose.kind === "OBJECTIVE" ? OBJECTIVE_HEIGHT / 2 : UNIT_HEIGHT;
  return {
    id: pose.entityId,
    kind: pose.kind,
    position: simulationToBabylonPosition({ x: pose.x, y: pose.y }, height),
    colorSlot,
  };
}

function applyPose(camera: ArcRotateCamera, pose: RtsCameraPose): void {
  camera.alpha = pose.alpha;
  camera.beta = RTS_CAMERA_BETA;
  camera.radius = pose.radius;
  camera.target.x = pose.targetX;
  camera.target.y = 0;
  camera.target.z = pose.targetZ;
}

function createGrid(scene: Scene, extent: GroundExtent): LinesMesh {
  const lines: Vector3[][] = [];
  for (let x = extent.minX; x <= extent.maxX; x += 2) {
    lines.push([new Vector3(x, 0.02, extent.minZ), new Vector3(x, 0.02, extent.maxZ)]);
  }
  for (let z = extent.minZ; z <= extent.maxZ; z += 2) {
    lines.push([new Vector3(extent.minX, 0.02, z), new Vector3(extent.maxX, 0.02, z)]);
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
    entity.kind === "OBJECTIVE"
      ? MeshBuilder.CreateCylinder(
          `objective-${entity.id}`,
          { diameterTop: 0.2, diameterBottom: 1.4, height: OBJECTIVE_HEIGHT, tessellation: 5 },
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
