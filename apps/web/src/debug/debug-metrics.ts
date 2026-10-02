/**
 * Client debug overlay gating.
 *
 * Default is Vite's built-in development flag — no extra deploy switch:
 * - `vite` / `pnpm dev` / Playwright's vite server: on (`import.meta.env.DEV`);
 * - `vite build` (Docker nginx image): off.
 * Lobby and connect UI are not gated by this flag.
 */
export function isDebugInstrumentationEnabled(devMode: boolean): boolean {
  return devMode;
}

/** About 3 samples/second. Debug metrics must not call setState on every render frame. */
export const DEBUG_METRICS_INTERVAL_MS = 333;

export function formatDebugCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }
  return String(Math.round(value));
}

export function formatFrameTimeMs(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }
  return value.toFixed(1);
}

/** `null` is the transport's explicit unavailable reading, including a future local transport. */
export function formatRoundTripLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return "unavailable";
  }
  return String(Math.round(value));
}
