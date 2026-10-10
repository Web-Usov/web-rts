import test from "node:test";
import assert from "node:assert/strict";
import { setupTheme } from "../src/theme.js";

function fixture(saved, dark = false, blocked = false) {
  const events = {};
  const icon = {},
    label = {},
    attributes = {};
  const media = { matches: dark, addEventListener: (_, fn) => (events.system = fn) };
  const host = {
    document: { documentElement: { dataset: {} } },
    matchMedia: () => media,
    localStorage: {
      getItem: () => {
        if (blocked) throw Error("blocked");
        return saved;
      },
      setItem: (_, value) => {
        if (blocked) throw Error("blocked");
        saved = value;
      },
    },
  };
  const button = {
    querySelector: (selector) => (selector.includes("icon") ? icon : label),
    setAttribute: (key, value) => (attributes[key] = value),
    addEventListener: (_, fn) => (events.click = fn),
  };
  const changes = [];
  setupTheme(button, (theme) => changes.push(theme), host);
  return { events, media, host, label, attributes, changes, saved: () => saved };
}

test("default follows OS changes and invalid stored modes fall back to system", () => {
  for (const preference of [null, "invalid", "system"]) {
    const f = fixture(preference);
    assert.equal(f.host.document.documentElement.dataset.theme, "light");
    assert.equal(f.label.textContent, "Системная");
    f.media.matches = true;
    f.events.system();
    assert.deepEqual(f.changes, ["light", "dark"]);
  }
});

test("button cycles modes, persists preference and explicit themes ignore OS changes", () => {
  const f = fixture(null, true);
  f.events.click();
  assert.equal(f.saved(), "light");
  assert.equal(f.host.document.documentElement.dataset.theme, "light");
  f.events.system();
  assert.equal(f.changes.length, 2);
  f.events.click();
  assert.equal(f.saved(), "dark");
  f.events.click();
  assert.equal(f.saved(), "system");
  assert.equal(f.label.textContent, "Системная");
  assert.match(f.attributes["aria-label"], /Системная.*Светлая/);
  assert.equal(fixture("dark").host.document.documentElement.dataset.theme, "dark");
});

test("storage failures do not prevent theme switching", () => {
  const f = fixture(null, false, true);
  f.events.click();
  f.events.click();
  assert.equal(f.host.document.documentElement.dataset.theme, "dark");
});
