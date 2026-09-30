/** Browser-visible game-server port when no explicit URL is configured. */
export const DEFAULT_GAME_SERVER_PORT = 2567;

/** Non-browser and test fallback. LAN clients must not rely on this host. */
export const DEFAULT_GAME_SERVER_URL = `http://localhost:${DEFAULT_GAME_SERVER_PORT}`;

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Inputs for {@link resolveGameServerEndpoint}.
 * Callers pass already-read env and hostname so the resolver stays free of
 * `window`, Vite, and sockets.
 */
export type GameServerEndpointInput = {
  /** `VITE_GAME_SERVER_URL` or another explicit browser URL. Wins when non-empty. */
  explicitUrl?: string | null | undefined;
  /** `window.location.hostname` when running in a browser. */
  pageHostname?: string | null | undefined;
  /** `VITE_GAME_SERVER_PORT` / published host port. Invalid values fall back to 2567. */
  configuredPort?: string | number | null | undefined;
};

/**
 * Resolves the Colyseus HTTP endpoint behind RemoteGameTransport.
 *
 * Priority:
 * 1. non-empty explicit URL;
 * 2. page hostname + configured game-server port (default 2567);
 * 3. `http://localhost:2567` when there is no page hostname.
 */
export function resolveGameServerEndpoint(input: GameServerEndpointInput = {}): string {
  const explicitUrl = normalizeOptionalString(input.explicitUrl);
  if (explicitUrl) {
    return explicitUrl;
  }

  const pageHostname = normalizeOptionalString(input.pageHostname);
  if (!pageHostname) {
    return DEFAULT_GAME_SERVER_URL;
  }

  const port = resolveGameServerPort(input.configuredPort);
  return `http://${formatHostname(pageHostname)}:${port}`;
}

export function resolveGameServerPort(
  configuredPort: GameServerEndpointInput["configuredPort"],
): number {
  if (typeof configuredPort === "number") {
    return isValidPort(configuredPort) ? configuredPort : DEFAULT_GAME_SERVER_PORT;
  }

  const raw = normalizeOptionalString(
    typeof configuredPort === "string" ? configuredPort : undefined,
  );
  if (!raw || !/^[0-9]+$/.test(raw)) {
    return DEFAULT_GAME_SERVER_PORT;
  }

  const port = Number(raw);
  return isValidPort(port) ? port : DEFAULT_GAME_SERVER_PORT;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname;
  }
  if (hostname.includes(":")) {
    return `[${hostname}]`;
  }
  return hostname;
}
