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
/** Auxiliary skin bones share the elbow pivot; they do not add editable joints. */
export const FOREARM_HELPERS = [
  "LeftForeArmSwing",
  "LeftForeArmTwist",
  "RightForeArmSwing",
  "RightForeArmTwist",
] as const;

/** Separate hinge swing from axial roll, retaining the original wrist motion. */
export function updateForearmTwists(bones: Bone[], previous = new Map<string, Quaternion>()): void {
  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  for (const side of ["Left", "Right"]) {
    const forearm = byName.get(`MeshStudio_${side}ForeArm`),
      hand = byName.get(`MeshStudio_${side}Hand`),
      hinge = byName.get(`MeshStudio_${side}ForeArmSwing`),
      middle = byName.get(`MeshStudio_${side}ForeArmTwist`);
    if (
      !forearm ||
      !hand ||
      !hinge ||
      !middle ||
      hand.parent !== forearm ||
      hinge.parent !== forearm.parent ||
      middle.parent !== forearm.parent
    )
      continue;
    const axis = hand.position.clone().normalize(),
      q = forearm.quaternion,
      projection = new Vector3(q.x, q.y, q.z).dot(axis),
      twist = new Quaternion(axis.x * projection, axis.y * projection, axis.z * projection, q.w);
    if (twist.lengthSq() < 1e-12) twist.identity();
    else twist.normalize();
    const last = previous.get(forearm.name);
    if ((last && twist.dot(last) < 0) || (!last && twist.w < 0))
      twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
    previous.set(forearm.name, twist.clone());
    const swing = q.clone().multiply(twist.clone().invert()),
      angle = 2 * Math.atan2(new Vector3(twist.x, twist.y, twist.z).dot(axis), twist.w);
    hinge.quaternion.copy(swing);
    middle.quaternion.copy(swing).multiply(new Quaternion().setFromAxisAngle(axis, angle * 0.5));
    hinge.updateMatrixWorld(true);
    middle.updateMatrixWorld(true);
  }
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
  const quantile = (values: number[], fraction: number, fallback: number) => {
    if (!values.length) return fallback;
    values.sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * fraction)]!;
  };
  // Surface medians depend on triangulation density; use the centre of a trimmed section.
  const sectionCenter = (section: Vector3[], axis: "x" | "y" | "z", fallback: number) =>
    (quantile(
      section.map((p) => p[axis]),
      0.05,
      fallback,
    ) +
      quantile(
        section.map((p) => p[axis]),
        0.95,
        fallback,
      )) /
    2;
  const torsoWidth = Math.min(
    height * 0.16,
    Math.max(
      height * 0.065,
      quantile(
        waist.map((p) => Math.abs(p.x - centerX)),
        0.9,
        height * 0.08,
      ) * 1.3,
    ),
  );
  const layout = {} as JointLayout;
  const central = points.filter((p) => Math.abs(p.x - centerX) < torsoWidth * 0.5);
  // Find where separated inner thighs meet. Clothes covering the gap retain the fallback.
  let crotch = y(0.46);
  for (let fraction = 0.42; fraction <= 0.54; fraction += 0.005) {
    const section = central.filter((p) => Math.abs(p.y - y(fraction)) < height * 0.006);
    if (
      section.length &&
      quantile(
        section.map((p) => Math.abs(p.x - centerX)),
        0.04,
        height,
      ) <
        height * 0.002
    ) {
      crotch = y(fraction);
      break;
    }
  }
  const hipY = Math.min(y(0.59), Math.max(y(0.52), crotch + torsoWidth * 1.1));
  const neckY = y(0.835);
  for (const [name, level] of [
    ["Hips", 0],
    ["Spine", 0.2],
    ["Spine1", 0.44],
    ["Spine2", 0.72],
    ["Neck", 1],
  ] as const) {
    const at = hipY + (neckY - hipY) * level;
    const section = central.filter((p) => Math.abs(p.y - at) < height * 0.015);
    layout[name] = new Vector3(centerX, at, sectionCenter(section, "z", centerZ));
  }
  const headSection = central.filter((p) => p.y > y(0.87) && p.y < y(0.93));
  for (const [name, level] of [
    ["Spine", 0.2],
    ["Spine1", 0.44],
    ["Spine2", 0.72],
  ] as const) {
    const axisZ = layout.Hips.z + (layout.Neck.z - layout.Hips.z) * level;
    layout[name].z = axisZ * 0.75 + layout[name].z * 0.25;
  }
  layout.Head = new Vector3(
    centerX,
    neckY + height * 0.04,
    layout.Neck.z * 0.8 + sectionCenter(headSection, "z", layout.Neck.z) * 0.2,
  );
  for (const [side, sign] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    const arm = points.filter((p) => sign * (p.x - centerX) > torsoWidth && p.y > y(0.4));
    const extent = Math.max(
      torsoWidth * 1.6,
      arm.reduce((max, p) => Math.max(max, sign * (p.x - centerX)), 0),
    );
    const section = (x: number) =>
      arm.filter((p) => Math.abs(sign * (p.x - centerX) - x) < height * 0.008);
    // The wrist is the narrow section before the palm, rather than a fraction of fingertip reach.
    let wristX = extent * 0.78,
      narrowest = Infinity;
    for (let x = extent * 0.62; x <= extent * 0.85; x += height * 0.005) {
      const slice = section(x);
      if (slice.length < 6) continue;
      const depth =
        quantile(
          slice.map((p) => p.z),
          0.9,
          0,
        ) -
        quantile(
          slice.map((p) => p.z),
          0.1,
          0,
        );
      if (depth > height * 0.002 && depth < narrowest) {
        narrowest = depth;
        wristX = x;
      }
    }
    wristX = Math.max(torsoWidth * 1.3, wristX);
    const elbowX = (torsoWidth * 1.15 + wristX) / 2;
    const elbow = section(elbowX),
      wrist = section(wristX),
      upper = section(torsoWidth * 1.5);
    const elbowY = sectionCenter(elbow, "y", y(0.78)),
      elbowZ = sectionCenter(elbow, "z", centerZ);
    const upperY = sectionCenter(upper, "y", y(0.8)),
      upperZ = sectionCenter(upper, "z", elbowZ);
    const slope = (torsoWidth * 0.5) / Math.max(height * 0.03, elbowX - torsoWidth * 1.5);
    const shoulderY = Math.min(neckY - height * 0.025, upperY + (upperY - elbowY) * slope);
    const shoulderZ = upperZ + (upperZ - elbowZ) * slope;
    layout[`${side}Shoulder`] = new Vector3(
      centerX + sign * torsoWidth * 0.35,
      shoulderY + height * 0.02,
      shoulderZ,
    );
    layout[`${side}Arm`] = new Vector3(centerX + sign * torsoWidth * 1.15, shoulderY, shoulderZ);
    layout[`${side}ForeArm`] = new Vector3(centerX + sign * elbowX, elbowY, elbowZ);
    layout[`${side}Hand`] = new Vector3(
      centerX + sign * wristX,
      sectionCenter(wrist, "y", elbowY),
      sectionCenter(wrist, "z", elbowZ),
    );
    const legSection = (at: number) =>
      points.filter(
        (p) => sign * (p.x - centerX) > height * 0.008 && Math.abs(p.y - at) < height * 0.015,
      );
    const hipSection = legSection(hipY - height * 0.04),
      knee = legSection(y(0.295)),
      ankle = legSection(y(0.07));
    const legPoint = (section: Vector3[], at: number, fallbackX: number) =>
      new Vector3(
        sectionCenter(section, "x", centerX + sign * fallbackX),
        at,
        sectionCenter(section, "z", centerZ),
      );
    layout[`${side}UpLeg`] = legPoint(hipSection, hipY - height * 0.035, height * 0.05);
    layout[`${side}Leg`] = legPoint(knee, y(0.295), height * 0.065);
    layout[`${side}Foot`] = legPoint(ankle, y(0.055), height * 0.075);
    const foot = points.filter((p) => sign * (p.x - centerX) > height * 0.015 && p.y < y(0.07));
    layout[`${side}ToeBase`] = new Vector3(
      layout[`${side}Foot`].x,
      y(0.004),
      quantile(
        foot.map((p) => forward * p.z),
        0.65,
        forward * centerZ,
      ) * forward,
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

const smooth = (value: number, low: number, high: number): number => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Anatomical chain weights, smoothed along welded triangle edges instead of across empty space. */
function skinWeights(geometry: BufferGeometry, draft: RigDraft, softness: number): void {
  const position = geometry.getAttribute("position"),
    count = position.count,
    n = JOINTS.length + FOREARM_HELPERS.length;
  const radius = draft.height * 0.024 * Math.max(0.4, Math.min(2, softness));
  const ids = new Map<JointName, number>(JOINTS.map(([name], i) => [name, i]));
  const torso: JointName[] = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"];
  const chains = (side: "Left" | "Right", arm: boolean): JointName[] =>
    arm
      ? [`${side}Arm`, `${side}ForeArm`, `${side}Hand`]
      : [`${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`];
  const chainData = (names: JointName[]) =>
    names.map((name, i) => ({
      id: ids.get(name)!,
      point: draft.layout[name],
      direction:
        i === 0
          ? new Vector3(0, 1, 0)
          : draft.layout[name]
              .clone()
              .sub(draft.layout[names[i - 1]!])
              .normalize(),
    }));
  const body = chainData(torso),
    arms = [chainData(chains("Left", true)), chainData(chains("Right", true))],
    legs = [chainData(chains("Left", false)), chainData(chains("Right", false))];
  const armAxes = ["Left", "Right"].map((side) => {
    const start = draft.layout[`${side}Arm` as JointName];
    return {
      start,
      direction: draft.layout[`${side}ForeArm` as JointName].clone().sub(start).normalize(),
    };
  });
  // Welding position duplicates keeps UV/material seams from becoming weight seams.
  const weld = new Map<string, number>(),
    vertices: Vector3[] = [],
    vertexIds = new Uint32Array(count);
  const epsilon = draft.height * 1e-6;
  for (let v = 0; v < count; v++) {
    const point = new Vector3().fromBufferAttribute(position, v),
      key = point
        .toArray()
        .map((x) => Math.round(x / epsilon))
        .join(",");
    let id = weld.get(key);
    if (id === undefined) {
      id = vertices.length;
      weld.set(key, id);
      vertices.push(point);
    }
    vertexIds[v] = id;
  }
  const dense = new Float32Array(vertices.length * n),
    tmp = new Vector3();
  const addChain = (v: number, data: ReturnType<typeof chainData>, amount: number) => {
    let remaining = amount;
    for (let i = 0; i < data.length - 1; i++) {
      const next = data[i + 1]!;
      const axial = data === body;
      const spine = axial && i < 3;
      const offset = spine ? (next.point.y - data[i]!.point.y) * 0.25 : 0;
      const width = spine ? radius * (0.04 / 0.024) : radius;
      // Torso pivots curve in depth; their surface weights must follow height,
      // otherwise the front and back of the same rib cage bend differently.
      const distance = axial
        ? vertices[v]!.y - next.point.y + offset
        : tmp.copy(vertices[v]!).sub(next.point).dot(next.direction);
      const gate = smooth(distance, -width, width);
      const index = v * n + data[i]!.id;
      dense[index] = dense[index]! + remaining * (1 - gate);
      remaining *= gate;
    }
    const last = v * n + data.at(-1)!.id;
    dense[last] = dense[last]! + remaining;
  };
  for (let v = 0; v < vertices.length; v++) {
    const p = vertices[v]!;
    const armAmounts = armAxes.map(({ start, direction }, side) => {
      tmp.copy(p).sub(start);
      const along = tmp.dot(direction),
        radial = Math.sqrt(Math.max(0, tmp.lengthSq() - along ** 2));
      // Protect the rib cage and head behind/away from the proximal upper-arm axis.
      const sign = side === 0 ? 1 : -1;
      const distal = smooth(
        sign * (p.x - draft.layout[side === 0 ? "LeftForeArm" : "RightForeArm"].x),
        -radius,
        radius,
      );
      return (
        smooth(along, -radius, radius) *
        (1 -
          smooth(
            radial,
            draft.height * (0.045 + 0.055 * distal),
            draft.height * (0.08 + 0.08 * distal),
          ))
      );
    });
    const totalArm = armAmounts[0]! + armAmounts[1]!,
      scale = totalArm > 1 ? 1 / totalArm : 1;
    const remainder = 1 - Math.min(1, totalArm);
    const legAmount =
      smooth(draft.layout.Hips.y - p.y, draft.height * 0.015, draft.height * 0.065) * remainder;
    const left = smooth(p.x - draft.centerX, -draft.height * 0.01, draft.height * 0.01);
    addChain(v, body, remainder - legAmount);
    addChain(v, arms[0]!, armAmounts[0]! * scale);
    addChain(v, arms[1]!, armAmounts[1]! * scale);
    addChain(v, legs[0]!, legAmount * left);
    addChain(v, legs[1]!, legAmount * (1 - left));
  }
  const adjacent = vertices.map(() => new Set<number>()),
    index = geometry.index;
  const edge = (a: number, b: number) => {
    if (a !== b && vertices[a]!.distanceToSquared(vertices[b]!) < (draft.height * 0.05) ** 2) {
      adjacent[a]!.add(b);
      adjacent[b]!.add(a);
    }
  };
  const corners = index?.count ?? count;
  for (let i = 0; i + 2 < corners; i += 3) {
    const a = vertexIds[index ? index.getX(i) : i]!,
      b = vertexIds[index ? index.getX(i + 1) : i + 1]!,
      c = vertexIds[index ? index.getX(i + 2) : i + 2]!;
    edge(a, b);
    edge(b, c);
    edge(c, a);
  }
  const seeds = dense.slice(),
    neighbors = adjacent.map((s) => [...s]);
  let current = dense,
    next = new Float32Array(dense.length);
  for (let step = 0; step < 8; step++) {
    for (let v = 0; v < vertices.length; v++) {
      const links = neighbors[v]!,
        offset = v * n;
      let strongest = 0;
      for (let j = 0; j < n; j++) strongest = Math.max(strongest, seeds[offset + j]!);
      const anchor = 0.35 + 0.65 * smooth(strongest, 0.9, 0.999);
      for (let j = 0; j < n; j++) {
        let sum = current[offset + j]!;
        for (const neighbor of links) sum += current[neighbor * n + j]!;
        next[offset + j] = anchor * seeds[offset + j]! + ((1 - anchor) * sum) / (links.length + 1);
      }
    }
    [current, next] = [next, current];
  }
  // Carry no axial roll at the elbow, half at mid-forearm, full near the wrist.
  // Adjacent skin transforms now differ by at most half the forearm twist.
  for (let v = 0; v < vertices.length; v++) {
    for (const [sideIndex, side] of ["Left", "Right"].entries()) {
      const elbow = draft.layout[`${side}ForeArm` as JointName],
        axis = draft.layout[`${side}Hand` as JointName].clone().sub(elbow),
        t = Math.max(0, Math.min(1, tmp.copy(vertices[v]!).sub(elbow).dot(axis) / axis.lengthSq())),
        first = smooth(t, 0, 0.5),
        second = smooth(t, 0.5, 1),
        index = v * n + ids.get(`${side}ForeArm` as JointName)!,
        amount = current[index]!;
      current[v * n + JOINTS.length + sideIndex * 2] = amount * (1 - first);
      current[v * n + JOINTS.length + sideIndex * 2 + 1] = amount * first * (1 - second);
      current[index] = amount * second;
    }
  }
  const indices = new Uint16Array(count * 4),
    weights = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    const offset = vertexIds[v]! * n;
    const candidates = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => current[offset + b]! - current[offset + a]!,
    );
    // Fade influences to zero at the fifth's score so top-four changes stay continuous.
    const cutoff = current[offset + candidates[4]!]!,
      scores = candidates.slice(0, 4).map((i) => Math.max(0, current[offset + i]! - cutoff));
    const total = scores.reduce((a, b) => a + b, 0);
    for (let slot = 0; slot < 4; slot++) {
      const weight = Math.fround(total > 1e-20 ? scores[slot]! / total : slot === 0 ? 1 : 0);
      indices[v * 4 + slot] = weight > 0 ? candidates[slot]! : 0;
      weights[v * 4 + slot] = weight;
    }
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
}

function testClips(
  bones: Record<JointName, Bone>,
  forward: number,
  allBones: Bone[],
): AnimationClip[] {
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
  const clips = [
    make("Тест: сгиб локтей", ["LeftForeArm", "RightForeArm"], axisArm, Math.PI * 0.6, true),
    make("Тест: сгиб коленей", ["LeftLeg", "RightLeg"], axisLeg, Math.PI * 0.5, false),
  ];
  for (const clip of clips) {
    const helpers = allBones.filter((bone) =>
        FOREARM_HELPERS.some((name) => bone.name === `MeshStudio_${name}`),
      ),
      values = helpers.map(() => [] as number[]),
      previous = new Map<string, Quaternion>();
    for (let i = 0; i < 5; i++) {
      for (const bone of allBones) bone.quaternion.identity();
      for (const track of clip.tracks) {
        const bone = allBones.find((bone) => track.name === `${bone.name}.quaternion`)!;
        bone.quaternion.fromArray(track.values, i * 4);
      }
      updateForearmTwists(allBones, previous);
      helpers.forEach((bone, j) => values[j]!.push(...bone.quaternion.toArray()));
    }
    helpers.forEach((bone, j) =>
      clip.tracks.push(
        new QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1, 2, 3, 4], values[j]!),
      ),
    );
  }
  for (const bone of allBones) bone.quaternion.identity();
  allBones[0]?.updateWorldMatrix(true, true);
  return clips;
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
  const helpers = FOREARM_HELPERS.map((name) => {
    const side = name.startsWith("Left") ? "Left" : "Right",
      bone = new Bone();
    bone.name = `MeshStudio_${name}`;
    bone.position.copy(bones[`${side}ForeArm`].position);
    bones[`${side}Arm`].add(bone);
    return bone;
  });
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton([...JOINTS.map(([name]) => bones[name]), ...helpers]),
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
    return {
      root,
      bones,
      skeleton,
      meshes: skinned,
      animations: testClips(bones, draft.forward, skeleton.bones),
    };
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
  updateForearmTwists(rig.skeleton.bones);
  rig.root.updateWorldMatrix(true, true);
  rig.skeleton.update();
}

export function disposeRig(rig: BoundRig): void {
  rig.meshes.forEach((mesh) => mesh.geometry.dispose());
  rig.skeleton.dispose();
}
