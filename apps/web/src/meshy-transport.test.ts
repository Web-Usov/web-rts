import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Transport, type TransportState } from "../meshy/src/transport";

const commands = {
  select: vi.fn(),
  play: vi.fn(),
  seek: vi.fn(),
  step: vi.fn(),
  speed: vi.fn(),
  loop: vi.fn(),
  rest: vi.fn(),
};
const state: TransportState = {
  clips: [],
  selected: 0,
  time: 0,
  playing: false,
  loop: true,
  speed: 1,
  busy: false,
};

describe("Mesh Studio transport", () => {
  it("shows a compact hint without unusable playback controls before a clip is loaded", () => {
    const html = renderToStaticMarkup(createElement(Transport, { state, commands }));
    expect(html).toContain("Создайте скелет и добавьте анимацию");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("0.00 с");
  });

  it("restores playback, seeking and time entry for a loaded clip", () => {
    const html = renderToStaticMarkup(
      createElement(Transport, {
        state: { ...state, clips: [{ name: "Sword Attack", duration: 2.5 }], time: 0.4 },
        commands,
      }),
    );
    expect(html).toContain("Sword Attack");
    expect(html).toContain('aria-label="Воспроизвести"');
    expect(html).toContain('aria-label="Позиция анимации"');
    expect(html).toContain('aria-label="Время анимации, секунды"');
    expect(html).toContain("2.50 с");
    expect(html).not.toContain("disabled");
  });
});
