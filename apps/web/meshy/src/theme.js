const storageKey = "meshy-theme";
const modes = ["system", "light", "dark"];
const labels = { system: "Системная", light: "Светлая", dark: "Тёмная" };
const icons = { system: "◐", light: "☀", dark: "☾" };

export function setupTheme(button, onChange, host = window) {
  const media = host.matchMedia("(prefers-color-scheme: dark)");
  let mode = "system";
  try {
    const saved = host.localStorage.getItem(storageKey);
    if (modes.includes(saved)) mode = saved;
  } catch {
    // Theme switching remains available when browser storage is unavailable.
  }
  const apply = () => {
    const resolved = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    host.document.documentElement.dataset.theme = resolved;
    button.querySelector("[data-theme-icon]").textContent = icons[mode];
    button.querySelector("[data-theme-label]").textContent = labels[mode];
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    button.setAttribute("aria-label", `Тема: ${labels[mode]}. Переключить: ${labels[next]}`);
    button.title = `Тема: ${labels[mode]} → ${labels[next]}`;
    onChange(resolved);
  };
  button.addEventListener("click", () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    try {
      host.localStorage.setItem(storageKey, mode);
    } catch {
      // The selected mode still applies for this visit.
    }
    apply();
  });
  media.addEventListener("change", () => {
    if (mode === "system") apply();
  });
  apply();
}
