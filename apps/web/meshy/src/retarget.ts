import {
  AnimationClip,
  AnimationMixer,
  Bone,
  LoopOnce,
  Matrix4,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { JOINTS } from "./rigging.ts";
import type { JointName } from "./rigging.ts";
import type { KeyframeTrack } from "three";

export type BoneMap = Partial<Record<JointName, string>>;
export interface RetargetOptions {
  sourceMap: BoneMap;
  targetMap: BoneMap;
  inPlace?: boolean;
  yaw?: number;
  name?: string;
}
const aliases: Record<JointName, string[]> = {
  Hips: ["hips", "hip", "pelvis"],
  Spine: ["spine", "spine01", "spine001", "spine1"],
  Spine1: ["spine1", "spine02", "spine002", "spine2"],
  Spine2: ["spine2", "spine03", "spine003", "chest", "upperchest"],
  Neck: ["neck", "neck01"],
  Head: ["head"],
  LeftShoulder: ["leftshoulder", "shoulderl", "claviclel"],
  LeftArm: ["leftarm", "leftupperarm", "upperarml", "arml"],
  LeftForeArm: ["leftforearm", "leftlowerarm", "lowerarml", "forearml"],
  LeftHand: ["lefthand", "handl", "wristl"],
  RightShoulder: ["rightshoulder", "shoulderr", "clavicler"],
  RightArm: ["rightarm", "rightupperarm", "upperarmr", "armr"],
  RightForeArm: ["rightforearm", "rightlowerarm", "lowerarmr", "forearmr"],
  RightHand: ["righthand", "handr", "wristr"],
  LeftUpLeg: ["leftupleg", "leftupperleg", "upperlegl", "thighl"],
  LeftLeg: ["leftleg", "leftlowerleg", "lowerlegl", "calfl", "shinl"],
  LeftFoot: ["leftfoot", "footl", "anklel"],
  LeftToeBase: ["lefttoebase", "lefttoe", "toel", "toesl", "balll"],
  RightUpLeg: ["rightupleg", "rightupperleg", "upperlegr", "thighr"],
  RightLeg: ["rightleg", "rightlowerleg", "lowerlegr", "calfr", "shinr"],
  RightFoot: ["rightfoot", "footr", "ankler"],
  RightToeBase: ["righttoebase", "righttoe", "toer", "toesr", "ballr"],
};
const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/^(mixamorig[:_]?|meshstudio_|armature[|:]|def[-_])/g, "")
    .replace(/[^a-z0-9]/g, "");

export function rigBones(root: Object3D, requireSkin = false): Bone[] {
  const bones: Bone[] = [],
    skins = new Set<string>();
  root.traverse((node) => {
    if (node instanceof Bone) bones.push(node);
    if (node instanceof SkinnedMesh)
      skins.add(
        node.skeleton.bones
          .map((b) => b.uuid)
          .sort()
          .join(","),
      );
  });
  if (requireSkin && !skins.size)
    throw new Error(
      "Сначала создайте и привяжите скелет во вкладке «Скелет» или откройте модель с ригом.",
    );
  if (!bones.length) throw new Error("В источнике нет скелета для переноса движения.");
  if (bones.length > 256 || skins.size > 1)
    throw new Error("Выберите одного персонажа со скелетом до 256 костей.");
  if (bones.some((b) => !b.name) || new Set(bones.map((b) => b.name)).size !== bones.length)
    throw new Error("Для переноса нужны уникальные непустые имена костей.");
  return bones;
}

export function autoBoneMap(root: Object3D): BoneMap {
  const bones = rigBones(root),
    result: BoneMap = {},
    used = new Set<string>();
  for (const [role] of JOINTS) {
    // Exact generated/Mixamo names take precedence over alternate naming schemes.
    const keys = [normalize(role), ...aliases[role]];
    const bone = keys
      .flatMap((key) => bones.filter((b) => normalize(b.name) === key))
      .find((b) => !used.has(b.name));
    if (bone) {
      result[role] = bone.name;
      used.add(bone.name);
    }
  }
  return result;
}

interface RestBone {
  bone: Bone;
  position: Vector3;
  rotation: Quaternion;
}
function snapshot(root: Object3D, requireSkin: boolean) {
  const copy = clone(root),
    bones = rigBones(copy, requireSkin);
  copy.updateMatrixWorld(true);
  const bindWorld = new Map<Bone, Matrix4>();
  copy.traverse((node) => {
    if (node instanceof SkinnedMesh)
      node.skeleton.bones.forEach((bone, i) =>
        bindWorld.set(bone, node.skeleton.boneInverses[i]!.clone().invert()),
      );
  });
  for (const bone of bones) {
    const matrix = bindWorld.get(bone);
    if (!matrix) continue;
    const parent =
      bone.parent instanceof Bone ? bindWorld.get(bone.parent) : bone.parent?.matrixWorld;
    const local = parent ? parent.clone().invert().multiply(matrix) : matrix;
    local.decompose(bone.position, bone.quaternion, bone.scale);
  }
  copy.updateMatrixWorld(true);
  const inverse = copy.matrixWorld.clone().invert();
  const rest = new Map<string, RestBone>();
  for (const bone of bones) {
    const matrix = inverse.clone().multiply(bone.matrixWorld),
      p = new Vector3(),
      q = new Quaternion();
    matrix.decompose(p, q, new Vector3());
    if (![...p.toArray(), ...q.toArray()].every(Number.isFinite))
      throw new Error("Некорректная исходная поза скелета.");
    rest.set(bone.name, { bone, position: p, rotation: q });
  }
  return { root: copy, bones, rest, inverse };
}

function frame(role: JointName, map: BoneMap, rest: Map<string, RestBone>): Quaternion {
  const entry = rest.get(map[role]!)!;
  const childRole = JOINTS.find(([, , parent]) => parent === role);
  let end = childRole && rest.get(map[childRole[0]] ?? "")?.position;
  if (!end) end = entry.bone.children.map((n) => rest.get(n.name)?.position).find(Boolean);
  let direction = end?.clone().sub(entry.position);
  if (!direction || direction.lengthSq() < 1e-12) {
    const parent = entry.bone.parent && rest.get(entry.bone.parent.name);
    direction = parent ? entry.position.clone().sub(parent.position) : new Vector3(0, 1, 0);
  }
  if (direction.lengthSq() < 1e-12) direction.set(0, 1, 0);
  const y = direction.normalize(),
    forward = new Vector3(0, 0, 1);
  if (Math.abs(y.dot(forward)) > 0.95) forward.set(0, 1, 0);
  const x = y.clone().cross(forward).normalize(),
    z = x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

const essential: JointName[] = [
  "Hips",
  "Head",
  "LeftArm",
  "RightArm",
  "LeftForeArm",
  "RightForeArm",
  "LeftUpLeg",
  "RightUpLeg",
  "LeftLeg",
  "RightLeg",
];

/** Samples world-space rest-pose corrections, retaining target proportions and bind matrices. */
export function retargetHumanoid(
  sourceRoot: Object3D,
  targetRoot: Object3D,
  clip: AnimationClip,
  options: RetargetOptions,
): AnimationClip {
  if (!(clip.duration > 0 && clip.duration <= 60) || clip.tracks.length > 2048)
    throw new Error("Выберите клип длительностью до 60 секунд и не более 2048 дорожек.");
  if (clip.tracks.reduce((sum, t) => sum + t.values.length, 0) > 1_000_000)
    throw new Error("Клип содержит слишком много ключевых кадров (лимит 1 000 000 значений).");
  if (clip.tracks.some((t) => !t.times.every(Number.isFinite) || !t.values.every(Number.isFinite)))
    throw new Error("Анимация содержит некорректные ключевые кадры.");
  const source = snapshot(sourceRoot, false),
    target = snapshot(targetRoot, true);
  const pairs = JOINTS.flatMap(([role]) => {
    const s = source.rest.get(options.sourceMap[role] ?? ""),
      t = target.rest.get(options.targetMap[role] ?? "");
    return s && t ? [{ role, s, t }] : [];
  });
  const missing = essential.filter((role) => !pairs.some((p) => p.role === role));
  if (missing.length)
    throw new Error(
      `Сопоставьте основные кости: ${missing.map((role) => JOINTS.find((j) => j[0] === role)![1]).join(", ")}.`,
    );
  for (const key of ["sourceMap", "targetMap"] as const) {
    const names = pairs.map((p) => options[key][p.role]);
    if (new Set(names).size !== names.length)
      throw new Error(
        "Одна кость не может соответствовать двум суставам. Исправьте сопоставление.",
      );
  }
  const animated = new Set(clip.tracks.map((t) => PropertyBinding.parseTrackName(t.name).nodeName));
  if (
    !pairs.some((p) => animated.has(p.s.bone.name) || animated.has(p.s.bone.uuid)) &&
    !clip.tracks.some((t) => t.name.includes(".bones["))
  )
    throw new Error("Клип не содержит движения сопоставленных костей.");
  const hip = pairs.find((p) => p.role === "Hips")!;
  const span = (rest: Map<string, RestBone>, map: BoneMap) => {
    const hips = rest.get(map.Hips!)!.position;
    const foot = rest.get(map.LeftFoot ?? map.LeftLeg ?? "")?.position;
    return foot ? hips.distanceTo(foot) : 0;
  };
  const sourceSpan = span(source.rest, options.sourceMap),
    targetSpan = span(target.rest, options.targetMap);
  if (sourceSpan < 1e-8 || targetSpan < 1e-8)
    throw new Error("Проверьте положение таза и ног в исходной позе.");
  const scale = targetSpan / sourceSpan,
    yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), options.yaw ?? 0);
  const corrections = pairs.map((p) => ({
    ...p,
    correction: frame(p.role, options.sourceMap, source.rest)
      .multiply(frame(p.role, options.targetMap, target.rest).invert())
      .multiply(p.t.rotation),
  }));
  const byTarget = new Map(corrections.map((p) => [p.t.bone, p]));
  const times: number[] = [],
    positions: number[] = [],
    values = new Map(corrections.map((p) => [p.t.bone, [] as number[]]));
  const mixer = new AnimationMixer(source.root),
    action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(0);
  source.root.updateMatrixWorld(true);
  // FBX clips can start far from the bind-pose origin. Transfer displacement, not that offset.
  const motionOrigin = new Vector3().setFromMatrixPosition(
    source.inverse.clone().multiply(hip.s.bone.matrixWorld),
  );
  const frames = Math.ceil(clip.duration * 30),
    matrix = new Matrix4(),
    current = new Quaternion(),
    point = new Vector3(),
    parentRotation = new Quaternion();
  const restHipLocal = hip.t.bone.position.clone();
  const hipParentInverse = target.inverse
    .clone()
    .multiply(hip.t.bone.parent?.matrixWorld ?? target.root.matrixWorld)
    .invert();
  const hipParentOrigin = new Vector3().applyMatrix4(hipParentInverse);
  try {
    for (let i = 0; i <= frames; i++) {
      const time = (clip.duration * i) / frames;
      times.push(time);
      mixer.setTime(time);
      source.root.updateMatrixWorld(true);
      for (const bone of target.bones) {
        const p = byTarget.get(bone);
        if (!p) continue;
        matrix.copy(source.inverse).multiply(p.s.bone.matrixWorld);
        matrix.decompose(point, current, new Vector3());
        const wanted = yaw
          .clone()
          .multiply(current)
          .multiply(p.s.rotation.clone().invert())
          .multiply(p.correction);
        if (bone.parent) {
          matrix.copy(target.inverse).multiply(bone.parent.matrixWorld);
          matrix.decompose(new Vector3(), parentRotation, new Vector3());
          bone.quaternion.copy(parentRotation.invert().multiply(wanted));
        } else bone.quaternion.copy(wanted);
        bone.updateMatrixWorld(true);
        values.get(bone)!.push(...bone.quaternion.normalize().toArray());
        if (p.role === "Hips") {
          const offset = point.clone().sub(motionOrigin).applyQuaternion(yaw).multiplyScalar(scale);
          if (options.inPlace !== false) {
            offset.x = 0;
            offset.z = 0;
          }
          // Convert displacement through the rest parent frame, including unit scaling.
          offset.applyMatrix4(hipParentInverse).sub(hipParentOrigin);
          positions.push(...restHipLocal.clone().add(offset).toArray());
        }
      }
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(source.root);
  }
  const tracks: KeyframeTrack[] = corrections.map(
    (p) => new QuaternionKeyframeTrack(`${p.t.bone.name}.quaternion`, times, values.get(p.t.bone)!),
  );
  tracks.push(new VectorKeyframeTrack(`${hip.t.bone.name}.position`, times, positions));
  const result = new AnimationClip(options.name ?? clip.name, clip.duration, tracks);
  return result;
}
