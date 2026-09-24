# ADR-008: pnpm workspaces + Turborepo

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

Web RTS развивается как TypeScript monorepo с несколькими приложениями и пакетами:

- `apps/web`;
- `apps/game-server`;
- `packages/simulation`;
- `packages/protocol`;
- `packages/game-data`;
- `packages/testkit`;
- tooling для bot/scenario runner.

Проект также ориентирован на agent-driven development и GitHub Actions CI. Поэтому нужен единый, предсказуемый интерфейс запуска задач по всему monorepo без ручного orchestration каждого package.

Одних `pnpm workspaces` достаточно для управления зависимостями и workspace packages, но при росте репозитория потребуется удобный task graph, кэширование и запуск только затронутых задач.

## Решение

Использовать связку:

```text
pnpm
  ├─ package manager
  └─ workspace management

Turborepo
  ├─ task graph
  ├─ build/test/typecheck/lint orchestration
  ├─ local task cache
  └─ affected/dependency-aware execution
```

Turborepo **не заменяет pnpm**.

Базовый tooling stack monorepo:

```text
Package manager:      pnpm
Workspace layer:      pnpm workspaces
Task orchestrator:    Turborepo
CI:                   GitHub Actions
```

## Стандартные задачи

Корневой `turbo.json` должен как минимум описывать:

- `build`;
- `test`;
- `typecheck`;
- `lint`;
- `dev`.

Ориентировочная модель:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

Фактический `turbo.json` может отличаться после scaffold, если этого потребуют реальные build outputs и package dependencies.

## Команды верхнего уровня

Coding agents и CI должны по возможности использовать единый root-level interface, например:

```bash
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Корневые scripts могут делегировать выполнение Turborepo:

```text
pnpm build -> turbo run build
pnpm test  -> turbo run test
```

Агент не должен знать внутреннюю команду сборки каждого workspace package, если это не требуется его конкретной задачей.

## CI

GitHub Actions использует pnpm для установки зависимостей и Turborepo для orchestration задач.

Цель:

```text
checkout
  ↓
pnpm install --frozen-lockfile
  ↓
turbo lint / typecheck / test / build
  ↓
server integration / Playwright E2E
```

Local cache включается сразу.

Remote cache **не является обязательной частью foundation**. Его можно подключить позже отдельным изменением, если время CI начнёт оправдывать дополнительную инфраструктуру/сервис.

## Архитектурная граница

Turborepo — исключительно repository/build tooling.

Runtime-код не должен зависеть от Turbo API или его наличия.

Удаление Turborepo в будущем не должно требовать изменения:

- simulation;
- game protocol;
- multiplayer architecture;
- renderer;
- gameplay code.

## Последствия

Плюсы:

- единый интерфейс для человека, CI и coding agents;
- dependency-aware task execution;
- локальный cache повторных задач;
- меньше лишних сборок и тестов по мере роста monorepo;
- естественно соответствует существующей package-структуре проекта.

Минусы:

- дополнительный tooling dependency;
- необходимо корректно описывать `outputs`, environment inputs и зависимости задач;
- ошибочная конфигурация cache может скрыть проблемы, поэтому non-deterministic tasks не должны кэшироваться без проверки.

## Не делаем сейчас

- не подключаем Turborepo Remote Cache как обязательную инфраструктуру;
- не используем Turbo как runtime/service orchestration layer;
- не строим сложную CI-матрицу до появления реальной необходимости;
- не дробим packages ради улучшения task graph — package boundaries определяются архитектурой проекта.

## Связь с Technical Vision

Это ADR уточняет разделы `Зафиксированный стек`, `Структура monorepo`, `CI` и `Agent-driven development` Technical Vision v0.1.

При scaffold foundation необходимо считать следующую формулировку зафиксированной:

> **Web RTS использует pnpm workspaces для package/workspace management и Turborepo для repository task orchestration и caching.**
