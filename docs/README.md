# Документация Web RTS

Этот каталог — источник продуктовых и технических решений проекта.

## Документы

- [`game-vision.md`](./game-vision.md) — Game Vision v0.1: направление игры, режимы, core loop, цели матча и границы MVP.
- [`technical-vision.md`](./technical-vision.md) — Technical Vision v0.1: зафиксированный стек, simulation architecture, networking, rendering, testing, CI и agent-driven development rules.
- [`technical-direction.md`](./technical-direction.md) — Technical Direction v0.1: предварительный документ, на основе которого сформирован Technical Vision. При расхождениях приоритет имеет `technical-vision.md`.

## Specs

- [`specs/001-foundation-network-vertical-slice.md`](./specs/001-foundation-network-vertical-slice.md) — Foundation Spec #001: первый authoritative multiplayer vertical slice, tooling, simulation kernel, transport, client/server integration, tests, CI и LAN startup.

Корневой [`AGENTS.md`](../AGENTS.md) содержит обязательные правила для coding agents: source-of-truth hierarchy, архитектурные инварианты, scope discipline и требования к PR/tests.

## ADR

- [`adr/000-pnpm-turborepo-monorepo.md`](./adr/000-pnpm-turborepo-monorepo.md) — pnpm workspaces для package/workspace management + Turborepo для task orchestration и caching.
- [`adr/001-authoritative-server-and-shared-simulation.md`](./adr/001-authoritative-server-and-shared-simulation.md) — authoritative multiplayer server и общая simulation для Solo/Coop/PvP.
- [`adr/002-babylonjs-renderer.md`](./adr/002-babylonjs-renderer.md) — Babylon.js как основной 3D renderer/client engine.
- [`adr/003-colyseus-multiplayer-layer.md`](./adr/003-colyseus-multiplayer-layer.md) — Colyseus как room/session/networking layer, отделённый от simulation.
- [`adr/004-fixed-timestep-and-repeatable-simulation.md`](./adr/004-fixed-timestep-and-repeatable-simulation.md) — fixed timestep 10 Hz и repeatable simulation с seeded RNG.
- [`adr/005-data-oriented-entity-model.md`](./adr/005-data-oriented-entity-model.md) — data-oriented system-driven entity model без обязательного ECS framework на старте.
- [`adr/006-local-vs-remote-game-transport.md`](./adr/006-local-vs-remote-game-transport.md) — единая GameTransport boundary для локального Solo и remote multiplayer.
- [`adr/007-replication-boundary-and-visibility.md`](./adr/007-replication-boundary-and-visibility.md) — отделение simulation state от network state и server-owned visibility/fog.

## Как развиваем документацию

- Продуктовые решения фиксируются в `game-vision.md` или отдельных спецификациях в `docs/specs/`.
- Значимые технические решения оформляются как ADR в `docs/adr/`.
- Реализация конкретной фичи должна начинаться со spec и acceptance criteria.
- GitHub Issues используются для задач реализации, а не как единственное место хранения продуктовой документации.
- Архитектурное решение, противоречащее Technical Vision, требует отдельного ADR.
- `main` должен оставаться в запускаемом и проверяемом состоянии.
