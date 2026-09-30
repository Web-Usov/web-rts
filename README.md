# Web RTS

Браузерная multiplayer RTS до 4 игроков с режимами Solo, Coop и PvP/PvPvE.

Проект находится на стадии foundation. Текущий network vertical slice уже включает authoritative Colyseus server, общую simulation, primitive Babylon presentation, create/join room flow, MOVE replication и reconnect.

Разработка идёт через spec-first и agent-driven workflow: требования → спецификация → реализация → автоматические тесты → review → playable build.

## Developer startup

Требования: **Node.js 22+** и **pnpm** (версия из поля `packageManager` в корневом `package.json`).

```bash
pnpm install
pnpm build
pnpm test
pnpm test:simulation
pnpm typecheck
pnpm lint
```

`pnpm test:simulation` runs headless simulation scenario tests via `tools/scenario-runner` (independent of the generic unit-test suite in CI).

Локальная разработка:

```bash
pnpm dev
```

`pnpm dev` поднимает Vite web-клиент и game server через root-level Turborepo orchestration. По умолчанию web доступен на `http://localhost:5173`, game server — на `http://localhost:2567`.

Корневые команды оркестрируются Turborepo (`pnpm build` → `turbo run build` и т.д.).

## Docker / LAN

Свежий clone можно поднять без локальной установки Node.js/pnpm:

```bash
docker compose up
```

По умолчанию web публикуется на `5173`, а Colyseus server — на `2567`. Web-клиент автоматически использует hostname, с которого была открыта страница, поэтому другой компьютер/телефон в той же LAN может открыть `http://<docker-host-ip>:5173` без изменения исходников.

Порты и optional browser-visible server URL настраиваются через `.env`. Полная инструкция, smoke check и LAN checklist: [docs/docker-lan.md](./docs/docker-lan.md).

## Структура monorepo

```text
apps/
  web/              # Vite + React shell and Babylon presentation
  game-server/      # Colyseus authoritative multiplayer server
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
