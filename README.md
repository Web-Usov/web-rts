# Web RTS

Браузерная multiplayer RTS до 4 игроков с режимами Solo, Coop и PvP/PvPvE.

Проект находится на стадии foundation scaffold: monorepo tooling уже есть, gameplay/renderer/multiplayer появятся в следующих foundation-задачах.

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

Локальная разработка (после появления реальных app entrypoints):

```bash
pnpm dev
```

Корневые команды оркестрируются Turborepo (`pnpm build` → `turbo run build` и т.д.).

## Структура monorepo

```text
apps/
  web/              # browser client (placeholder in F0)
  game-server/      # multiplayer server (placeholder in F0)
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
- [ADR-000: pnpm workspaces + Turborepo](./docs/adr/000-pnpm-turborepo-monorepo.md)
- [AGENTS.md](./AGENTS.md) — правила для coding agents
- [Индекс документации](./docs/README.md)

Текущий приоритет — технологический foundation и первый multiplayer vertical slice до полноценного gameplay и визуального polish.
