import { useEffect, useState } from "react";
import { mountPresentation } from "./presentation/scene.js";
import type { HudView } from "./presentation/types.js";

const emptyHud: HudView = {
  entityCount: 0,
  selectedIds: [],
  hasDestination: false,
};

export function App() {
  const [hud, setHud] = useState<HudView>(emptyHud);

  useEffect(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (!canvas) {
      return;
    }

    const session = mountPresentation(canvas, setHud);
    return () => {
      session.dispose();
    };
  }, []);

  const selected = hud.selectedIds.length === 0 ? "none" : hud.selectedIds.map(String).join(", ");

  return (
    <div className="shell">
      <canvas id="game-canvas" className="viewport" />
      <aside className="hud">
        <p className="hud-title">Web RTS</p>
        <p>Primitive presentation shell. No gameplay authority.</p>
        <dl>
          <div>
            <dt>Entities</dt>
            <dd>{hud.entityCount}</dd>
          </div>
          <div>
            <dt>Selected</dt>
            <dd>{selected}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{hud.hasDestination ? "marked" : "none"}</dd>
          </div>
        </dl>
        <ul>
          <li>Middle or right drag pans</li>
          <li>Wheel zooms</li>
          <li>Left click selects a primitive</li>
          <li>Right click on the map sets a destination marker</li>
        </ul>
      </aside>
    </div>
  );
}
