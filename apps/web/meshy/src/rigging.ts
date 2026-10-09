import {
  AnimationClip,
  Bone,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import type { Material, Object3D } from "three";

export const JOINTS = [
  ["Hips", "Таз", null],
  ["Spine", "Поясница", "Hips"],
  ["Spine1", "Спина", "Spine"],
  ["Spine2", "Грудь", "Spine1"],
  ["Neck", "Шея", "Spine2"],
  ["Head", "Голова", "Neck"],
  ["LeftShoulder", "Л. ключица", "Spine2"],
  ["LeftArm", "Л. плечо", "LeftShoulder"],
  ["LeftForeArm", "Л. локоть", "LeftArm"],
  ["LeftHand", "Л. кисть", "LeftForeArm"],
  ["RightShoulder", "П. ключица", "Spine2"],
  ["RightArm", "П. плечо", "RightShoulder"],
  ["RightForeArm", "П. локоть", "RightArm"],
  ["RightHand", "П. кисть", "RightForeArm"],
  ["LeftUpLeg", "Л. бедро", "Hips"],
  ["LeftLeg", "Л. колено", "LeftUpLeg"],
  ["LeftFoot", "Л. голеностоп", "LeftLeg"],
  ["LeftToeBase", "Л. стопа", "LeftFoot"],
  ["RightUpLeg", "П. бедро", "Hips"],
  ["RightLeg", "П. колено", "RightUpLeg"],
  ["RightFoot", "П. голеностоп", "RightLeg"],
  ["RightToeBase", "П. стопа", "RightFoot"],
] as const;
export type JointName = (typeof JOINTS)[number][0];
export type JointLayout = Record<JointName, Vector3>;
export interface RigDraft {
  layout: JointLayout;
  height: number;
  centerX: number;
  forward: number;
}
export interface BoundRig {
  root: Group;
  bones: Record<JointName, Bone>;
  skeleton: Skeleton;
  meshes: SkinnedMesh[];
  animations: AnimationClip[];
}
const MAX_VERTICES = 200_000;

export function copyLayout(layout: JointLayout): JointLayout {
  return Object.fromEntries(JOINTS.map(([name]) => [name, layout[name].clone()])) as JointLayout;
}

function sourceMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  let count = 0;
  root.traverseVisible((node) => {
    if (!(node instanceof Mesh)) return;
    if (node instanceof SkinnedMesh)
      throw new Error("В модели уже есть скелет. Автоскелет предназначен для моделей без рига.");
    if (node instanceof InstancedMesh || node.geometry.morphAttributes.position?.length) {
      throw new Error(
        "Автоскелет не поддерживает инстансы и morph targets. Откройте обычный статический меш.",
      );
    }
    const position = node.geometry.getAttribute("position");
    if (!position) return;
    count += position.count;
    if (count > MAX_VERTICES)
      throw new Error("Для автоскелета нужна модель не более 200 000 вершин.");
    meshes.push(node);
  });
  if (!meshes.length) throw new Error("В модели нет геометрии для привязки.");
  return meshes;
}

function relativeMatrices(root: Object3D, meshes: Mesh[]): Matrix4[] {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  return meshes.map((mesh) => inverse.clone().multiply(mesh.matrixWorld));
}

const median = (values: number[], fallback: number): number => {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
};

/** Geometry-based initial fit for upright, separated-limb T/A-pose humanoids. */
export function fitHumanoid(root: Object3D, forward = 1): RigDraft {
  const meshes = sourceMeshes(root),
    matrices = relativeMatrices(root, meshes);
  const points: Vector3[] = [];
  meshes.forEach((mesh, index) => {
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const point = new Vector3().fromBufferAttribute(position, i).applyMatrix4(matrices[index]!);
      if (![point.x, point.y, point.z].every(Number.isFinite))
        throw new Error("Некорректные координаты модели.");
      points.push(point);
    }
  });
  const bounds = new Box3().setFromPoints(points),
    center = bounds.getCenter(new Vector3());
  const height = bounds.max.y - bounds.min.y;
  if (!(height > 1e-8)) throw new Error("Персонаж должен стоять вертикально вдоль оси Y.");
  const y = (fraction: number) => bounds.min.y + height * fraction;
  const waist = points.filter((p) => p.y > y(0.57) && p.y < y(0.68));
  const centerX = median(
    waist.map((p) => p.x),
    center.x,
  );
  const centerZ = median(
    waist.map((p) => p.z),
    center.z,
  );
  const torsoWidth = Math.min(
    height * 0.19,
    Math.max(
      height * 0.1,
      median(
        waist.map((p) => Math.abs(p.x - centerX)),
        height * 0.12,
      ),
    ),
  );
  const layout = {} as JointLayout;
  for (const [name, fraction] of [
    ["Hips", 0.51],
    ["Spine", 0.59],
    ["Spine1", 0.66],
    ["Spine2", 0.74],
    ["Neck", 0.83],
    ["Head", 0.9],
  ] as const) {
    layout[name] = new Vector3(centerX, y(fraction), centerZ);
  }
  for (const [side, sign] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    const arm = points.filter((p) => sign * (p.x - centerX) > torsoWidth && p.y > y(0.4));
    const extent = Math.max(
      torsoWidth * 1.6,
      arm.reduce((max, p) => Math.max(max, sign * (p.x - centerX)), 0),
    );
    const wristX = Math.max(torsoWidth * 1.3, extent * 0.88),
      elbowX = (torsoWidth + wristX) / 2;
    const section = (x: number) =>
      arm.filter((p) => Math.abs(sign * (p.x - centerX) - x) < height * 0.045);
    const elbow = section(elbowX),
      wrist = section(wristX);
    layout[`${side}Shoulder`] = new Vector3(centerX + sign * torsoWidth * 0.38, y(0.765), centerZ);
    layout[`${side}Arm`] = new Vector3(centerX + sign * torsoWidth, y(0.765), centerZ);
    layout[`${side}ForeArm`] = new Vector3(
      centerX + sign * elbowX,
      median(
        elbow.map((p) => p.y),
        y(0.74),
      ),
      median(
        elbow.map((p) => p.z),
        centerZ,
      ),
    );
    layout[`${side}Hand`] = new Vector3(
      centerX + sign * wristX,
      median(
        wrist.map((p) => p.y),
        y(0.73),
      ),
      median(
        wrist.map((p) => p.z),
        centerZ,
      ),
    );
    const leg = points.filter(
      (p) => sign * (p.x - centerX) > height * 0.015 && p.y > y(0.15) && p.y < y(0.4),
    );
    const legX = Math.max(
      height * 0.055,
      Math.min(
        height * 0.15,
        median(
          leg.map((p) => sign * (p.x - centerX)),
          height * 0.08,
        ),
      ),
    );
    const foot = points.filter((p) => sign * (p.x - centerX) > height * 0.015 && p.y < y(0.12));
    const legZ = median(
        leg.map((p) => p.z),
        centerZ,
      ),
      footZ = median(
        foot.map((p) => p.z),
        legZ,
      );
    layout[`${side}UpLeg`] = new Vector3(centerX + sign * legX, y(0.49), centerZ);
    layout[`${side}Leg`] = new Vector3(centerX + sign * legX, y(0.275), legZ);
    layout[`${side}Foot`] = new Vector3(
      centerX + sign * legX,
      y(0.065),
      footZ - forward * height * 0.025,
    );
    layout[`${side}ToeBase`] = new Vector3(
      centerX + sign * legX,
      y(0.025),
      footZ + forward * height * 0.055,
    );
  }
  return { layout, height, centerX, forward: forward < 0 ? -1 : 1 };
}

export function moveJoint(
  draft: RigDraft,
  name: JointName,
  position: Vector3,
  symmetric: boolean,
): void {
  if (![position.x, position.y, position.z].every(Number.isFinite))
    throw new Error("Координаты сустава должны быть конечными числами.");
  if (position.distanceTo(draft.layout.Hips) > draft.height * 3)
    throw new Error("Сустав слишком далеко от модели.");
  draft.layout[name].copy(position);
  if (symmetric && /^(Left|Right)/.test(name)) {
    const opposite = name.replace(/^(Left|Right)/, (prefix) =>
      prefix === "Left" ? "Right" : "Left",
    ) as JointName;
    draft.layout[opposite].set(2 * draft.centerX - position.x, position.y, position.z);
  }
}

function bakeGeometry(mesh: Mesh, matrix: Matrix4): BufferGeometry {
  const geometry = mesh.geometry.clone();
  for (const name of ["position", "normal", "tangent"]) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++)
      for (let c = 0; c < attribute.itemSize; c++) {
        values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
      }
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
  }
  geometry.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    if (!geometry.index)
      geometry.setIndex(
        Array.from({ length: geometry.getAttribute("position").count }, (_, i) => i),
      );
    const indices = geometry.index!.array;
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
  }
  geometry.userData = {};
  return geometry;
}

/** Local segment distances with hierarchy-neighbour blending; not a heat/ML solver. */
function skinWeights(geometry: BufferGeometry, draft: RigDraft, softness: number): void {
  const segments = JOINTS.map(([name]) => {
    const children = JOINTS.filter(([, , parent]) => parent === name);
    const child = children.find(([id]) => id === "Spine" || id === "Neck") ?? children[0];
    const start = draft.layout[name];
    const parent = JOINTS.find(([id]) => id === name)![2];
    const end = child
      ? draft.layout[child[0]]
      : start.clone().add(
          start
            .clone()
            .sub(parent ? draft.layout[parent] : start)
            .multiplyScalar(name === "Head" ? 0.75 : 0.3),
        );
    const direction = end.clone().sub(start);
    return { start, direction, length2: Math.max(direction.lengthSq(), draft.height ** 2 * 1e-10) };
  });
  const neighbours = JOINTS.map(([name, , parent], i) =>
    JOINTS.flatMap(([id, , p], j) => (i === j || id === parent || p === name ? [j] : [])),
  );
  const position = geometry.getAttribute("position"),
    indices = new Uint16Array(position.count * 4),
    weights = new Float32Array(position.count * 4);
  const distances = new Float64Array(JOINTS.length);
  const radius2 = (draft.height * 0.035) ** 2,
    exponent = 2 / Math.max(0.4, Math.min(2, softness));
  for (let vertex = 0; vertex < position.count; vertex++) {
    let nearest = 0;
    segments.forEach(({ start, direction, length2 }, i) => {
      const dx = position.getX(vertex) - start.x,
        dy = position.getY(vertex) - start.y,
        dz = position.getZ(vertex) - start.z;
      const t = Math.max(
        0,
        Math.min(1, (dx * direction.x + dy * direction.y + dz * direction.z) / length2),
      );
      distances[i] =
        (dx - t * direction.x) ** 2 + (dy - t * direction.y) ** 2 + (dz - t * direction.z) ** 2;
      if (distances[i]! < distances[nearest]!) nearest = i;
    });
    const candidates = [...neighbours[nearest]!]
      .sort((a, b) => distances[a]! - distances[b]!)
      .slice(0, 4);
    const scores = candidates.map((i) => (1 + distances[i]! / radius2) ** -exponent),
      total = scores.reduce((a, b) => a + b, 0);
    candidates.forEach((index, slot) => {
      indices[vertex * 4 + slot] = index;
      weights[vertex * 4 + slot] = scores[slot]! / total;
    });
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
}

function testClips(bones: Record<JointName, Bone>, forward: number): AnimationClip[] {
  const axisArm = new Vector3(0, 0, 1),
    axisLeg = new Vector3(forward, 0, 0);
  const make = (title: string, ids: JointName[], axis: Vector3, angle: number, mirror: boolean) =>
    new AnimationClip(
      title,
      4,
      ids.map(
        (id, index) =>
          new QuaternionKeyframeTrack(
            `${bones[id].name}.quaternion`,
            [0, 1, 2, 3, 4],
            [0, 0.5, 1, 0.5, 0].flatMap((t) =>
              new Quaternion()
                .setFromAxisAngle(axis, t * angle * (mirror && index === 1 ? -1 : 1))
                .toArray(),
            ),
          ),
      ),
    );
  return [
    make("Тест: сгиб локтей", ["LeftForeArm", "RightForeArm"], axisArm, Math.PI * 0.6, true),
    make("Тест: сгиб коленей", ["LeftLeg", "RightLeg"], axisLeg, Math.PI * 0.5, false),
  ];
}

export function bindHumanoid(
  source: Object3D,
  draft: RigDraft,
  materials: Map<string, Material | Material[]> = new Map(),
  softness = 1,
): BoundRig {
  const meshes = sourceMeshes(source),
    matrices = relativeMatrices(source, meshes);
  for (const [name, , parent] of JOINTS) {
    const p = draft.layout[name];
    if (
      ![p.x, p.y, p.z].every(Number.isFinite) ||
      (parent && p.distanceTo(draft.layout[parent]) < draft.height * 1e-5)
    ) {
      throw new Error("Соседние суставы не должны совпадать; проверьте координаты скелета.");
    }
  }
  const root = new Group();
  root.name = "MeshStudioRig";
  root.position.copy(source.position);
  root.quaternion.copy(source.quaternion);
  root.scale.copy(source.scale);
  const bones = Object.fromEntries(
    JOINTS.map(([name]) => {
      const bone = new Bone();
      bone.name = `MeshStudio_${name}`;
      return [name, bone];
    }),
  ) as Record<JointName, Bone>;
  JOINTS.forEach(([name, , parent]) => {
    bones[name].position.copy(draft.layout[name]);
    if (parent) {
      bones[name].position.sub(draft.layout[parent]);
      bones[parent].add(bones[name]);
    } else root.add(bones[name]);
  });
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(JOINTS.map(([name]) => bones[name])),
    skinned: SkinnedMesh[] = [];
  try {
    meshes.forEach((mesh, index) => {
      const geometry = bakeGeometry(mesh, matrices[index]!);
      try {
        skinWeights(geometry, draft, softness);
      } catch (error) {
        geometry.dispose();
        throw error;
      }
      const skin = new SkinnedMesh(geometry, materials.get(mesh.uuid) ?? mesh.material);
      skin.name = mesh.name || `Mesh_${index + 1}`;
      root.add(skin);
      root.updateMatrixWorld(true);
      skin.bind(skeleton, skin.matrixWorld);
      skin.normalizeSkinWeights();
      skin.frustumCulled = false;
      skinned.push(skin);
    });
    skeleton.update();
    return { root, bones, skeleton, meshes: skinned, animations: testClips(bones, draft.forward) };
  } catch (error) {
    skinned.forEach((mesh) => mesh.geometry.dispose());
    skeleton.dispose();
    throw error;
  }
}

export function poseRig(rig: BoundRig, elbows: number, knees: number, forward = 1): void {
  JOINTS.forEach(([name]) => rig.bones[name].quaternion.identity());
  rig.bones.LeftForeArm.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), elbows);
  rig.bones.RightForeArm.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -elbows);
  for (const name of ["LeftLeg", "RightLeg"] as const)
    rig.bones[name].quaternion.setFromAxisAngle(new Vector3(forward, 0, 0), knees);
  rig.root.updateWorldMatrix(true, true);
  rig.skeleton.update();
}

export function disposeRig(rig: BoundRig): void {
  rig.meshes.forEach((mesh) => mesh.geometry.dispose());
  rig.skeleton.dispose();
}
