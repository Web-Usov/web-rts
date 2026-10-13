import type { AnimationAction, AnimationMixer } from "three";

export const PREVIEW_FPS = 30;

export function clampTime(time: number, duration: number): number {
  return Math.min(Math.max(Number.isFinite(time) ? time : 0, 0), Math.max(0, duration));
}

export function frameTime(time: number, direction: number, duration: number): number {
  return clampTime((Math.round(time * PREVIEW_FPS) + direction) / PREVIEW_FPS, duration);
}

/** Seek in clip seconds, independent of playback speed; evaluate even while paused. */
export function seekAction(mixer: AnimationMixer, action: AnimationAction, time: number): number {
  const position = clampTime(time, action.getClip().duration);
  action.enabled = true;
  action.paused = true;
  action.time = position;
  action.play();
  mixer.update(0);
  return position;
}
