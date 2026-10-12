import {
  edgeAxis,
  normalizedAxis,
  wheelPixels,
  type CameraViewport,
  type ScreenPoint,
  RtsCameraController,
} from "./camera.js";

const BINDINGS: Record<string, string> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyR: "in",
  KeyF: "out",
  ShiftLeft: "fast",
  ShiftRight: "fast",
  KeyQ: "ccw",
  KeyE: "cw",
  Home: "home",
};
export class CameraKeys {
  private readonly held = new Set<string>();
  press(code: string, repeat: boolean): string | null {
    const action = BINDINGS[code];
    if (!action) return null;
    const already = this.held.has(code);
    this.held.add(code);
    return repeat || already ? "held" : action;
  }
  release(code: string): void {
    this.held.delete(code);
  }
  clear(): void {
    this.held.clear();
  }
  read(): { pan: ScreenPoint; zoom: number; fast: boolean } {
    const active = new Set([...this.held].map((code) => BINDINGS[code]));
    const on = (name: string) => Number(active.has(name));
    return {
      pan: normalizedAxis(on("right") - on("left"), on("down") - on("up")),
      zoom: on("out") - on("in"),
      fast: active.has("fast"),
    };
  }
}

/** Shared click/drag arbitration. Once the gesture crosses threshold, it stays a drag. */
export class CameraGesture {
  private start: ScreenPoint | null = null;
  private last: ScreenPoint | null = null;
  private button = -1;
  private moved = false;
  get active(): boolean {
    return this.start !== null;
  }
  down(button: number, point: ScreenPoint): void {
    this.start = point;
    this.last = point;
    this.button = button;
    this.moved = button === 1;
  }
  move(point: ScreenPoint): { from: ScreenPoint; to: ScreenPoint } | null {
    if (!this.start || !this.last) return null;
    const wasMoved = this.moved;
    this.moved ||= Math.hypot(point.x - this.start.x, point.y - this.start.y) >= 5;
    const from = wasMoved ? this.last : this.start;
    this.last = point;
    return this.moved && (this.button === 1 || this.button === 2) ? { from, to: point } : null;
  }
  up(): number | null {
    const click = this.start && !this.moved ? this.button : null;
    this.clear();
    return click;
  }
  clear(): void {
    this.start = null;
    this.last = null;
    this.button = -1;
    this.moved = false;
  }
}
export function blocksCamera(element: EventTarget | null): boolean {
  return (
    element instanceof Element &&
    Boolean(
      element.closest(
        'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"], .hud, .debug-overlay',
      ),
    )
  );
}

export function bindCameraInput(
  canvas: HTMLCanvasElement,
  controller: RtsCameraController,
  view: () => CameraViewport,
  isActive: () => boolean,
  click: (button: number, point: ScreenPoint) => void,
) {
  const keys = new CameraKeys(),
    gesture = new CameraGesture();
  let pointer: ScreenPoint | null = null;
  let captured: number | null = null;
  let edgeEnabled = true;
  const allowed = () =>
    document.hasFocus() &&
    !document.hidden &&
    canvas.clientWidth > 0 &&
    canvas.clientHeight > 0 &&
    isActive() &&
    !blocksCamera(document.activeElement);
  const point = (event: MouseEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const clear = () => {
    keys.clear();
    gesture.clear();
    pointer = null;
    if (captured !== null && canvas.hasPointerCapture(captured))
      canvas.releasePointerCapture(captured);
    captured = null;
  };
  const keydown = (event: KeyboardEvent) => {
    if (!allowed() || blocksCamera(event.target) || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const action = keys.press(event.code, event.repeat);
    if (!action) return;
    event.preventDefault();
    if (action === "home") controller.home();
    if (action === "ccw") controller.rotate(-1);
    if (action === "cw") controller.rotate(1);
  };
  const keyup = (event: KeyboardEvent) => keys.release(event.code);
  const down = (event: PointerEvent) => {
    if (!isActive() || event.pointerType !== "mouse" || gesture.active) return;
    canvas.focus({ preventScroll: true });
    gesture.down(event.button, point(event));
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      captured = event.pointerId;
    }
  };
  const move = (event: PointerEvent) => {
    pointer = event.target === canvas ? point(event) : null;
    const drag = gesture.move(point(event));
    if (drag) controller.drag(drag.from, drag.to, view());
  };
  const up = (event: PointerEvent) => {
    // Account for the last movement even if pointermove was coalesced.
    const drag = gesture.move(point(event));
    if (drag) controller.drag(drag.from, drag.to, view());
    const button = gesture.up();
    if (captured !== null && canvas.hasPointerCapture(captured))
      canvas.releasePointerCapture(captured);
    captured = null;
    const p = point(event),
      v = view();
    if (
      button !== null &&
      event.target === canvas &&
      p.x >= 0 &&
      p.y >= 0 &&
      p.x < v.width &&
      p.y < v.height &&
      allowed()
    )
      click(button, p);
  };
  const leave = () => {
    pointer = null;
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (allowed())
      controller.wheel(wheelPixels(event.deltaY, event.deltaMode, view().height), point(event));
  };
  const context = (event: Event) => event.preventDefault();
  const focus = (event: FocusEvent) => {
    if (blocksCamera(event.target)) clear();
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
  document.addEventListener("focusin", focus);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("pointercancel", clear);
  canvas.addEventListener("lostpointercapture", clear);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", context);
  return {
    setEdgeEnabled(value: boolean) {
      edgeEnabled = value;
      pointer = null;
    },
    step(dt: number) {
      if (!allowed()) clear();
      const input = keys.read();
      let edge = { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if (
        edgeEnabled &&
        pointer &&
        !gesture.active &&
        allowed() &&
        document.elementFromPoint(pointer.x + rect.left, pointer.y + rect.top) === canvas
      )
        edge = edgeAxis(pointer, view());
      return controller.step(
        dt,
        gesture.active ? { x: 0, y: 0 } : { x: input.pan.x + edge.x, y: input.pan.y + edge.y },
        input.zoom,
        input.fast,
        view(),
      );
    },
    dispose() {
      clear();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", clear);
      canvas.removeEventListener("lostpointercapture", clear);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", context);
    },
  };
}
