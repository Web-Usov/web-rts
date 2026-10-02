import { formatDebugCount, formatFrameTimeMs, formatRoundTripLabel } from "./debug-metrics.js";

export type DebugOverlayView = {
  fps: number;
  roundTripMs: number | null;
  tick: number;
  entityCount: number;
  drawCalls: number;
  activeMeshes: number;
  frameTimeMs: number;
};

type DebugOverlayProps = {
  view: DebugOverlayView;
  onShowInspector: () => void;
};

/**
 * Development-only metrics. Anchored to the top-right so the lobby HUD stays usable.
 * The parent samples `view` a few times per second; this component does not poll the frame.
 */
export function DebugOverlay({ view, onShowInspector }: DebugOverlayProps) {
  return (
    <aside className="debug-overlay" data-testid="debug-overlay">
      <p className="debug-title">Debug</p>
      <dl>
        <div>
          <dt>FPS</dt>
          <dd>{formatDebugCount(view.fps)}</dd>
        </div>
        <div>
          <dt>RTT</dt>
          <dd>{formatRoundTripLabel(view.roundTripMs)}</dd>
        </div>
        <div>
          <dt>Server tick</dt>
          <dd>{formatDebugCount(view.tick)}</dd>
        </div>
        <div>
          <dt>Entities</dt>
          <dd>{formatDebugCount(view.entityCount)}</dd>
        </div>
        <div>
          <dt>Draw calls</dt>
          <dd>{formatDebugCount(view.drawCalls)}</dd>
        </div>
        <div>
          <dt>Active meshes</dt>
          <dd>{formatDebugCount(view.activeMeshes)}</dd>
        </div>
        <div>
          <dt>Frame ms</dt>
          <dd>{formatFrameTimeMs(view.frameTimeMs)}</dd>
        </div>
      </dl>
      <button type="button" onClick={onShowInspector}>
        Inspector
      </button>
    </aside>
  );
}
