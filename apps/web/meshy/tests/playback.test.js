import test from "node:test";
import assert from "node:assert/strict";
import { AnimationMixer, AnimationClip, NumberKeyframeTrack, Object3D, LoopOnce } from "three";
import { clampTime, frameTime, seekAction } from "../src/playback.ts";

function player(speed = 1) {
  const root = new Object3D();
  const mixer = new AnimationMixer(root);
  mixer.timeScale = speed;
  const clip = new AnimationClip("Удар", 1, [
    new NumberKeyframeTrack(".position[x]", [0, 1], [0, 10]),
  ]);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1).play();
  action.clampWhenFinished = true;
  return { root, mixer, action };
}

test("seek evaluates exact paused pose independently of playback speed", () => {
  for (const speed of [0.1, 0.25, 1, 2]) {
    const { root, mixer, action } = player(speed);
    seekAction(mixer, action, 0.4);
    assert.ok(Math.abs(root.position.x - 4) < 1e-6);
    assert.equal(action.paused, true);
    mixer.update(1);
    assert.equal(action.time, 0.4);
    assert.equal(root.position.x, 4);
  }
});

test("seek reaches final pose and rewinds a completed clip", () => {
  const { root, mixer, action } = player();
  mixer.update(2);
  assert.equal(action.paused, true);
  seekAction(mixer, action, 0.2);
  assert.ok(Math.abs(root.position.x - 2) < 1e-6);
  seekAction(mixer, action, 9);
  assert.equal(action.time, 1);
  assert.equal(root.position.x, 10);
  action.reset().play();
  mixer.update(0.1);
  assert.ok(Math.abs(root.position.x - 1) < 1e-6);
});

test("frame steps use clip seconds and clamp both boundaries", () => {
  assert.equal(frameTime(0.4, 1, 1.5), 13 / 30);
  assert.equal(frameTime(0.4, -1, 1.5), 11 / 30);
  assert.equal(frameTime(0, -1, 1.5), 0);
  assert.equal(frameTime(1.5, 1, 1.5), 1.5);
  assert.equal(clampTime(NaN, 1), 0);
  assert.equal(clampTime(Infinity, 1), 0);
});
