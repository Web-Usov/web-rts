# Web RTS

Браузерная multiplayer RTS до 4 игроков с режимами Solo, Coop и PvP/PvPvE.

Проект находится на стадии foundation. Уже есть simulation kernel, Babylon-клиент, authoritative Colyseus game-server, replication, ownership/control, browser multiplayer E2E и reconnect. Полноценный gameplay и визуальный polish ещё впереди.

Разработка идёт через spec-first и agent-driven workflow: требования → спецификация → реализация → автоматические тесты → review → playable build.

## Developer startup

Требования: **Node.js 22+** и **pnpm** (версия из поля `packageManager` в корневом `package.json`).

```bash
pnpm install
pnpm build
pnpm test
pnpm test:simulation
pnpm test:server
pnpm test:e2e
pnpm typecheck
pnpm lint
```

`pnpm test:simulation` runs headless simulation scenario tests via `tools/scenario-runner` (independent of the generic unit-test suite in CI).

`pnpm test:server` runs Colyseus integration tests for the game server.

Локальная разработка:

```bash
pnpm dev
```

`pnpm dev` поднимает web-клиент на `http://localhost:5173` (Vite) и authoritative game-server на `http://localhost:2567`. Клиент подключается через `RemoteGameTransport`: явный `VITE_GAME_SERVER_URL` имеет приоритет, иначе в браузере используется hostname страницы и порт game-server (по умолчанию `2567`).

## Docker / LAN

Свежий clone можно поднять без правки исходников:

```bash
docker compose up
```

Другое устройство в той же LAN открывает `http://<docker-host-lan-ip>:5173` и подключается к game-server на этом хосте. Порты, явный URL, smoke и ручной checklist: [docs/docker-lan.md](./docs/docker-lan.md).

Проверка уже запущенного Compose-стека:

```bash
pnpm test:docker-smoke
```

Корневые команды оркестрируются Turborepo (`pnpm build` → `turbo run build` и т.д.). `pnpm test:docker-smoke` — отдельный readiness-скрипт, не turbo task.

## Структура monorepo

```text
apps/
  web/              # Vite + React shell and Babylon presentation
  game-server/      # authoritative Colyseus game server
packages/
  simulation/       # framework-agnostic game rules
  protocol/         # command/event contracts
  game-data/        # declarative balance/config
  testkit/          # shared test helpers
tools/
  bot-client/
  scenario-runner/
```

## Документация

- [Game Vision v0.1](./docs/game-vision.md)
- [Technical Vision v0.1](./docs/technical-vision.md)
- [Technical Direction v0.1](./docs/technical-direction.md)
- [Foundation Spec #001](./docs/specs/001-foundation-network-vertical-slice.md)
- [Docker / LAN startup](./docs/docker-lan.md)
- [ADR-000: pnpm workspaces + Turborepo](./docs/adr/000-pnpm-turborepo-monorepo.md)
- [AGENTS.md](./AGENTS.md) — правила для coding agents
- [Индекс документации](./docs/README.md)

Текущий приоритет — технологический foundation и первый multiplayer vertical slice до полноценного gameplay и визуального polish.
