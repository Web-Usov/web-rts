import { createGameServer } from "./app-config.js";
import { DEFAULT_PORT } from "./constants.js";

const port = Number.parseInt(process.env["PORT"] ?? String(DEFAULT_PORT), 10);

const server = createGameServer();

await server.listen(Number.isFinite(port) ? port : DEFAULT_PORT);

console.log(`[@web-rts/game-server] listening on ${Number.isFinite(port) ? port : DEFAULT_PORT}`);
