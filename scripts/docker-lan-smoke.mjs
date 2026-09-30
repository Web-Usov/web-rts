/**
 * Readiness smoke for `docker compose up`.
 * Expects the stack to already be running and honors WEB_PORT / GAME_SERVER_PORT.
 */

const DEFAULT_WEB_PORT = 5173;
const DEFAULT_GAME_SERVER_PORT = 2567;
const TIMEOUT_MS = 120_000;
const INTERVAL_MS = 1_000;

try {
  const webPort = readPort("WEB_PORT", DEFAULT_WEB_PORT);
  const gameServerPort = readPort("GAME_SERVER_PORT", DEFAULT_GAME_SERVER_PORT);
  const host = readHost();

  await waitForOk(
    "game-server /health",
    `http://${host}:${gameServerPort}/health`,
    (response, body) => {
      if (!response.ok) {
        return `HTTP ${response.status}: ${snippet(body)}`;
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return `invalid JSON: ${snippet(body)}`;
      }
      if (!parsed || parsed.status !== "ok") {
        return `unexpected body: ${snippet(body)}`;
      }
      return null;
    },
  );

  await waitForOk("web client", `http://${host}:${webPort}/`, (response, body) => {
    if (!response.ok) {
      return `HTTP ${response.status}: ${snippet(body)}`;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return `content-type ${contentType || "(missing)"}`;
    }
    if (!body.includes("Web RTS")) {
      return "HTML does not include Web RTS";
    }
    return null;
  });

  console.log(
    `docker smoke ok: web http://${host}:${webPort}/ game-server http://${host}:${gameServerPort}/health`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function readHost() {
  const raw = process.env.DOCKER_SMOKE_HOST;
  if (raw === undefined || raw.trim() === "") {
    return "127.0.0.1";
  }
  return raw.trim();
}

function readPort(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer port, received ${JSON.stringify(raw)}`);
  }
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be between 1 and 65535, received ${raw}`);
  }
  return port;
}

async function waitForOk(label, url, accept) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastDetail = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      const detail = accept(response, body);
      if (detail === null) {
        return;
      }
      lastDetail = detail;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
    }
    await delay(INTERVAL_MS);
  }

  throw new Error(`${label} was not ready at ${url}: ${lastDetail}`);
}

function snippet(body) {
  return body.replace(/\s+/g, " ").slice(0, 180);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
