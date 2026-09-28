import { useEffect, useRef, useState } from "react";
import {
  GAME_DATA_VERSION,
  PROTOCOL_VERSION,
  type GameEvent,
  type GameStateView,
  type MatchPhase,
  type TransportConnectionNotice,
} from "@web-rts/protocol";
import { ClientGameState } from "./client/client-game-state.js";
import { getBrowserGameTransport } from "./network/remote-game-transport.js";
import { mountPresentation } from "./presentation/scene.js";
import type { HudView } from "./presentation/types.js";

const emptyHud: HudView = {
  entityCount: 0,
  objectiveCount: 0,
  selectedIds: [],
  hasDestination: false,
};

type ConnectionStatus = "disconnected" | "connecting" | "reconnecting" | "connected" | "error";

export function App() {
  const [hud, setHud] = useState<HudView>(emptyHud);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [roomId, setRoomId] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [phase, setPhase] = useState<MatchPhase | "-">("-");
  const [localPlayerId, setLocalPlayerId] = useState<number | null>(null);
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [fps, setFps] = useState(0);
  const [lastEvent, setLastEvent] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState("");

  const transportRef = useRef<ReturnType<typeof getBrowserGameTransport> | null>(null);
  const clientStateRef = useRef<ClientGameState | null>(null);
  const commandCounter = useRef(0);

  useEffect(() => {
    const transport = getBrowserGameTransport();
    const clientState = new ClientGameState();
    transportRef.current = transport;
    clientStateRef.current = clientState;
    let alive = true;

    const unsubState = transport.subscribeState((view: GameStateView) => {
      // Presentation clock only — not used by simulation (AGENTS §8).
      clientState.applyAuthoritativeState(view, performance.now());
      setPhase(view.phase);
      setLocalPlayerId(view.localPlayerId);
      setRoomId(view.roomId);
      setConnectedPlayers(view.players.filter((player) => player.connected).length);
    });
    const unsubEvent = transport.subscribeEvent((event: GameEvent) => {
      clientState.handleEvent(event);
      setLastEvent(`${event.type}${event.type === "COMMAND_REJECTED" ? `: ${event.reason}` : ""}`);
    });
    const unsubConnection = transport.subscribeConnection((notice: TransportConnectionNotice) => {
      if (!alive) {
        return;
      }
      if (notice === "reconnecting") {
        setStatus("reconnecting");
        setErrorMessage("");
      } else if (notice === "reconnected") {
        setStatus("connected");
        setErrorMessage("");
      } else if (notice === "left") {
        setStatus("disconnected");
      } else {
        setStatus("error");
        setErrorMessage("session expired");
      }
    });

    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    const session = canvas
      ? mountPresentation(
          canvas,
          setHud,
          {
            transport,
            clientState,
            nextCommandId: () => {
              commandCounter.current += 1;
              return `cmd-${commandCounter.current}`;
            },
          },
          setFps,
        )
      : null;

    if (transport.hasResumeToken()) {
      setStatus("reconnecting");
      setErrorMessage("");
    }
    void transport.resumePreviousSession().then((result) => {
      if (!alive) {
        return;
      }
      if (result.status === "restored") {
        setStatus("connected");
        setRoomId(transport.connectedRoomId ?? "");
        setErrorMessage("");
      } else if (result.status === "expired") {
        setStatus("error");
        setErrorMessage("session expired");
      }
    });

    return () => {
      alive = false;
      unsubState();
      unsubEvent();
      unsubConnection();
      session?.dispose();
      // Reload must stay an unexpected socket drop. Consented leave here would
      // free the slot and wipe the sessionStorage token before resume can run.
    };
  }, []);

  const connect = async (mode: "create" | "join"): Promise<void> => {
    const transport = transportRef.current;
    if (!transport) {
      return;
    }
    setStatus("connecting");
    setErrorMessage("");
    try {
      const options =
        mode === "create"
          ? {
              protocolVersion: PROTOCOL_VERSION,
              gameDataVersion: GAME_DATA_VERSION,
              createRoom: true,
              seed: 1,
              mapId: "foundation",
            }
          : {
              protocolVersion: PROTOCOL_VERSION,
              gameDataVersion: GAME_DATA_VERSION,
              createRoom: false,
              roomId: joinRoomId.trim(),
              seed: 1,
              mapId: "foundation",
            };
      await transport.connect(options);
      setRoomId(transport.connectedRoomId ?? "");
      setStatus("connected");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "connect_failed");
    }
  };

  const startMatch = (): void => {
    transportRef.current?.startMatch();
  };

  const disconnect = async (): Promise<void> => {
    await transportRef.current?.disconnect();
    setStatus("disconnected");
    setPhase("-");
    setLocalPlayerId(null);
    setConnectedPlayers(0);
    setRoomId("");
  };

  const selected = hud.selectedIds.length === 0 ? "none" : hud.selectedIds.map(String).join(", ");

  return (
    <div className="shell">
      <canvas id="game-canvas" className="viewport" />
      <aside className="hud">
        <p className="hud-title">Web RTS</p>
        <p>Foundation match.</p>

        <div className="lobby">
          <label>
            Join room id
            <input
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value)}
              placeholder="paste room id"
            />
          </label>
          <div className="lobby-actions">
            <button
              type="button"
              onClick={() => void connect("create")}
              disabled={status === "connecting" || status === "reconnecting"}
            >
              Create room
            </button>
            <button
              type="button"
              onClick={() => void connect("join")}
              disabled={
                status === "connecting" ||
                status === "reconnecting" ||
                joinRoomId.trim().length === 0
              }
            >
              Join room
            </button>
            <button type="button" onClick={startMatch} disabled={status !== "connected"}>
              Start
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={status !== "connected"}
            >
              Disconnect
            </button>
          </div>
        </div>

        <dl>
          <div>
            <dt>Status</dt>
            <dd>{status}</dd>
          </div>
          <div>
            <dt>Room</dt>
            <dd>{roomId || "—"}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{phase}</dd>
          </div>
          <div>
            <dt>Local player</dt>
            <dd>{localPlayerId ?? "—"}</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>{connectedPlayers}</dd>
          </div>
          <div>
            <dt>FPS</dt>
            <dd>{fps}</dd>
          </div>
          <div>
            <dt>Entities</dt>
            <dd>{hud.entityCount}</dd>
          </div>
          <div>
            <dt>Objectives</dt>
            <dd>{hud.objectiveCount}</dd>
          </div>
          <div>
            <dt>Selected</dt>
            <dd>{selected}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{hud.hasDestination ? "marked" : "none"}</dd>
          </div>
          <div>
            <dt>Last event</dt>
            <dd>{lastEvent || "—"}</dd>
          </div>
        </dl>
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
        <ul>
          <li>Middle or right drag pans</li>
          <li>Wheel zooms</li>
          <li>Left click selects your primitive unit</li>
          <li>Right click moves the selected unit (marker is UX only)</li>
        </ul>
      </aside>
    </div>
  );
}
