# Docker / LAN startup

F9 provides a Docker Compose path for running the current Web RTS multiplayer vertical slice on one machine and opening it from other devices on the same LAN.

## Requirements

- Docker Engine / Docker Desktop with Docker Compose v2;
- no PostgreSQL, Redis, or other external service is required.

## Start

From a fresh clone:

```bash
docker compose up
```

Compose builds and starts:

- `web` — static Vite build served by nginx;
- `game-server` — the normal `@web-rts/game-server` production `start` script.

Default host URLs:

```text
Web client:        http://localhost:5173
Game server:       http://localhost:2567
Game server health http://localhost:2567/health
```

Stop the stack with:

```bash
docker compose down
```

## LAN access

Find the LAN IPv4 address of the Docker host, for example `192.168.1.50`, then open this URL on another device connected to the same LAN:

```text
http://192.168.1.50:5173
```

When `GAME_SERVER_URL` is not set, the web client automatically uses the same hostname that served the page and the configured `GAME_SERVER_PORT`. In the example above it connects to:

```text
http://192.168.1.50:2567
```

This avoids hard-coding `localhost`, which would point at the second device itself.

If the host firewall is enabled, allow inbound TCP traffic to the configured web and game-server ports for the local network.

## Configuration

Copy `.env.example` to `.env` if you need non-default values:

```bash
cp .env.example .env
```

Supported variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `5173` | Host TCP port exposing the nginx web client. |
| `GAME_SERVER_PORT` | `2567` | Host TCP port exposing Colyseus. The web build uses this port when no explicit server URL is set. |
| `GAME_SERVER_URL` | empty | Optional browser-visible absolute game-server URL, e.g. `http://192.168.1.50:2567`. |

`GAME_SERVER_URL` and `GAME_SERVER_PORT` are web build inputs. After changing them for an already-built image, rebuild the web image:

```bash
docker compose up --build
```

The game-server container itself always listens on its internal port `2567`; `GAME_SERVER_PORT` controls only the Docker host mapping.

## Automated smoke check

With the Compose stack running:

```bash
pnpm test:docker-smoke
```

The smoke script waits for and verifies:

- `GET /health` on the game server returns `{ "status": "ok" }`;
- the web container serves the Web RTS HTML shell.

It respects `WEB_PORT`, `GAME_SERVER_PORT`, `WEB_URL`, `GAME_SERVER_URL`, and `SMOKE_TIMEOUT_MS`.

## Manual LAN checklist

1. Run `docker compose up` on the host.
2. Confirm both services become healthy with `docker compose ps`.
3. Open `http://<host-lan-ip>:<WEB_PORT>` from a second device on the same LAN.
4. Create a room on one browser/device and join it from another browser/device.
5. Start the match and confirm authoritative MOVE replication between clients.
6. Reload one client and confirm the existing reconnect flow still restores the session within its grace period.
7. Confirm `http://<host-lan-ip>:<GAME_SERVER_PORT>/health` returns an OK response.

No source edit should be necessary for any step above.
