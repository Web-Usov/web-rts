import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PREVIEW_FPS } from "./playback";

export interface TransportState {
  clips: { name: string; duration: number }[];
  selected: number;
  time: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  busy: boolean;
}
export interface TransportCommands {
  select(index: number): void;
  play(): void;
  seek(time: number): void;
  step(direction: number): void;
  speed(value: number): void;
  loop(value: boolean): void;
  rest(): void;
}

function TimeInput({
  time,
  duration,
  disabled,
  seek,
}: {
  time: number;
  duration: number;
  disabled: boolean;
  seek(time: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-label="Время анимации, секунды"
      min="0"
      max={duration}
      step={1 / PREVIEW_FPS}
      value={draft ?? Number(time.toFixed(3))}
      disabled={disabled}
      onFocus={() => setDraft(time.toFixed(3))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null) seek(Number(draft));
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function Transport({
  state,
  commands,
}: {
  state: TransportState;
  commands: TransportCommands;
}) {
  const duration = state.clips[state.selected]?.duration ?? 0;
  const disabled = state.busy || !duration;
  if (!state.clips.length) {
    return (
      <section className="transport transport-placeholder" aria-label="Управление анимацией">
        <span className="transport-empty">Создайте скелет и добавьте анимацию</span>
      </section>
    );
  }
  return (
    <section className="transport" aria-label="Управление анимацией">
      <div className="transport-top">
        <div className="transport-title">
          <span className="eyebrow">АНИМАЦИЯ</span>
          {state.clips.length ? (
            <select
              aria-label="Активный клип"
              value={state.selected}
              disabled={state.busy}
              onChange={(event) => commands.select(Number(event.target.value))}
            >
              {state.clips.map((clip, index) => (
                <option value={index} key={index}>
                  {clip.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="transport-empty">Создайте скелет и добавьте анимацию</span>
          )}
        </div>
        <div className="transport-options">
          <label>
            Скорость{" "}
            <select
              aria-label="Скорость воспроизведения"
              disabled={disabled}
              value={state.speed}
              onChange={(event) => commands.speed(Number(event.target.value))}
            >
              {[0.1, 0.25, 0.5, 1, 1.5, 2].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
          <button
            aria-pressed={state.loop}
            disabled={disabled}
            onClick={() => commands.loop(!state.loop)}
          >
            Повтор
          </button>
          <button disabled={disabled} onClick={commands.rest}>
            Исходная поза
          </button>
        </div>
      </div>
      <div className="transport-track">
        <div className="transport-buttons">
          <button
            aria-label="Предыдущий кадр"
            title="Предыдущий кадр (←)"
            disabled={disabled}
            onClick={() => commands.step(-1)}
          >
            ‹|
          </button>
          <button
            className="play-button"
            aria-label={state.playing ? "Пауза" : "Воспроизвести"}
            title="Воспроизведение / пауза (Пробел)"
            disabled={disabled}
            onClick={commands.play}
          >
            {state.playing ? "Ⅱ" : "▶"}
          </button>
          <button
            aria-label="Следующий кадр"
            title="Следующий кадр (→)"
            disabled={disabled}
            onClick={() => commands.step(1)}
          >
            |›
          </button>
        </div>
        <input
          className="timeline"
          type="range"
          aria-label="Позиция анимации"
          min="0"
          max={duration || 1}
          step="0.001"
          value={Math.min(state.time, duration)}
          disabled={disabled}
          onChange={(event) => commands.seek(Number(event.target.value))}
        />
        <div className="timecode">
          <TimeInput
            time={state.time}
            duration={duration}
            disabled={disabled}
            seek={commands.seek}
          />
          <span>/ {duration.toFixed(2)} с</span>
        </div>
      </div>
    </section>
  );
}

export function mountTransport(element: HTMLElement, commands: TransportCommands) {
  const root = createRoot(element);
  return (state: TransportState) => root.render(<Transport state={state} commands={commands} />);
}
