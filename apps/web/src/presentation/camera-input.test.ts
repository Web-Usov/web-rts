import { describe, expect, it } from "vitest";
import { CameraKeys, CameraGesture } from "./camera-input.js";

describe("C1 input arbitration", () => {
  it("cancels opposite bindings and normalizes diagonals", () => {
    const keys = new CameraKeys();
    keys.press("KeyW", false);
    keys.press("ArrowDown", false);
    expect(keys.read().pan).toEqual({ x: 0, y: 0 });
    keys.release("ArrowDown");
    keys.press("KeyD", false);
    expect(Math.hypot(keys.read().pan.x, keys.read().pan.y)).toBeCloseTo(1);
    keys.press("ShiftLeft", false);
    expect(keys.read().fast).toBe(true);
    keys.clear();
    expect(keys.read()).toEqual({ pan: { x: 0, y: 0 }, zoom: 0, fast: false });
  });
  it("uses physical-key state so alternate keys do not release each other", () => {
    const keys = new CameraKeys();
    keys.press("KeyW", false);
    keys.press("ArrowUp", false);
    keys.release("KeyW");
    expect(keys.read().pan.y).toBe(-1);
    expect(keys.press("KeyQ", false)).toBe("ccw");
    expect(keys.press("KeyQ", true)).toBe("held");
    expect(keys.press("KeyQ", false)).toBe("held");
    keys.release("KeyQ");
    expect(keys.press("KeyQ", false)).toBe("ccw");
    expect(keys.press("Space", false)).toBeNull();
  });
  it("R/F hold cancel and Shift release clears boost", () => {
    const keys = new CameraKeys();
    keys.press("KeyR", false);
    expect(keys.read().zoom).toBe(-1);
    keys.press("KeyF", false);
    expect(keys.read().zoom).toBe(0);
    keys.release("KeyR");
    expect(keys.read().zoom).toBe(1);
    keys.press("ShiftRight", false);
    keys.release("ShiftRight");
    expect(keys.read().fast).toBe(false);
  });
  it("RMB deadzone remains a click and a returned drag never becomes MOVE", () => {
    const gesture = new CameraGesture();
    gesture.down(2, { x: 0, y: 0 });
    expect(gesture.move({ x: 3, y: 2 })).toBeNull();
    expect(gesture.up()).toBe(2);
    gesture.down(2, { x: 0, y: 0 });
    expect(gesture.move({ x: 10, y: 0 })).not.toBeNull();
    gesture.move({ x: 0, y: 0 });
    expect(gesture.up()).toBeNull();
  });
  it("middle drag is immediate, cancellation never creates a click", () => {
    const gesture = new CameraGesture();
    gesture.down(1, { x: 0, y: 0 });
    expect(gesture.move({ x: 1, y: 0 })).not.toBeNull();
    expect(gesture.up()).toBeNull();
    gesture.down(2, { x: 0, y: 0 });
    gesture.clear();
    expect(gesture.up()).toBeNull();
    gesture.down(0, { x: 0, y: 0 });
    gesture.move({ x: 20, y: 0 });
    expect(gesture.up()).toBeNull();
  });
});
