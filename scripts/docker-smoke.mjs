const webPort = process.env.WEB_PORT ?? "5173";
const gameServerPort = process.env.GAME_SERVER_PORT ?? "2567";
const webUrl = process.env.WEB_URL ?? `http://127.0.0.1:${webPort}`;

let gameServerUrl = process.env.GAME_SERVER_URL?.trim();
if (!gameServerUrl) {
  gameServerUrl = `http://127.0.0.1:${gameServerPort}`;
}

const rawTimeout = process.env.SMOKE_TIMEOUT_MS ?? "60000";
const parsedTimeout = Number(rawTimeout);
const timeoutMs = Number.isFinite(parsedTimeout) ? parsedTimeout : 60_000;
const deadline = Date.now() + timeoutMs;

async function waitFor(name, check) {
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await check();
      console.log(`[docker-smoke] ${name}: ok`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  let detail = String(lastError);
  if (lastError instanceof Error) {
    detail = lastError.message;
  }
  throw new Error(`[docker-smoke] ${name}: ${detail}`);
}

await waitFor("game-server health", async () => {
  const response = await fetch(new URL("/health", gameServerUrl));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.status !== "ok") {
    throw new Error(`unexpected body ${JSON.stringify(body)}`);
  }
});

await waitFor("web client", async () => {
  const response = await fetch(webUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  if (!html.includes("<title>Web RTS</title>")) {
    throw new Error("Web RTS HTML marker not found");
  }
});

console.log(`[docker-smoke] web=${webUrl}`);
console.log(`[docker-smoke] game-server=${gameServerUrl}`);
