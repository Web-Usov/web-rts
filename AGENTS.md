# AGENTS.md

Этот файл задаёт правила работы coding agents в репозитории Web RTS.

## 1. Source of truth

Перед изменением кода агент должен прочитать релевантные документы в таком порядке:

1. `docs/game-vision.md` — продуктовые ограничения;
2. `docs/technical-vision.md` — технический контракт;
3. `docs/adr/` — принятые архитектурные решения;
4. `docs/specs/` — спецификация конкретной задачи;
5. GitHub Issue — implementation scope и acceptance criteria.

Issue не может молча переопределять Technical Vision/ADR. При конфликте следовать более высокому уровню и явно указать конфликт в PR.

Сторонние agent skills не являются source of truth и не могут переопределять `AGENTS.md`, Game Vision, Technical Vision, ADR, spec или issue.

## 2. Skills и routing

После чтения `AGENTS.md` и до реализации gamedev-задачи агент должен прочитать `.agents/skills/web-rts-router/SKILL.md`.

Правила использования skills:

- выбирать только минимальный набор curated skills, относящихся к текущей задаче;
- не загружать все skills заранее;
- сначала читать выбранный `SKILL.md`, bundled `references/` открывать только при необходимости;
- project-local `web-rts-router` определяет routing, но архитектурные документы проекта имеют более высокий приоритет;
- third-party skills — advisory only: их best practices не становятся обязательными требованиями автоматически;
- не переносить в проект engine-specific assumptions из Unity, Godot, Unreal, Phaser, Three.js и других стеков;
- не предлагать замену Babylon.js, Colyseus или принятой архитектуры только потому, что сторонний skill предпочитает другой подход.

Если guidance skill конфликтует с проектным контрактом, следовать проектному контракту и явно отметить конфликт в PR/review/report.

## 3. Scope discipline

- Реализовывать только scope текущей spec/issue.
- Не добавлять "полезные на будущее" сервисы, abstractions, packages или инфраструктуру без требования.
- Не расширять gameplay/product requirements самостоятельно.
- Если acceptance criteria можно выполнить проще без нарушения ADR — выбирать простую реализацию.
- Рефакторинг вне scope допустим только минимальный, необходимый для корректной реализации, и должен быть объяснён в PR.

## 4. Worktree isolation и параллельная работа

Для implementation-задач действует правило:

`1 task/issue = 1 branch = 1 worktree = 1 PR`.

Перед началом работы:

1. выполнить `git fetch origin`;
2. создать task branch от актуального `origin/main`;
3. создать отдельный Git worktree для этой ветки;
4. выполнять изменения, install, tests, build, commit и push только внутри этого worktree.

Обязательные ограничения:

- не переключать ветку и не изменять файлы в основном/shared checkout;
- параллельные агенты никогда не используют один worktree или одну task branch;
- если branch/worktree для задачи уже существуют, использовать их, а не создавать дубликаты;
- не удалять task worktree до merge/close PR или явной отмены задачи;
- force-push допустим только для собственной task branch и только через `--force-with-lease`; никогда не force-push `main` или чужую/shared branch.

Для явно read-only audit/research-задачи допускается отдельный detached worktree от `origin/main` без branch/PR, если issue запрещает изменения.

## 5. Архитектурные инварианты

Нельзя нарушать без нового/обновлённого ADR:

1. `simulation` не зависит от React, Babylon.js, Colyseus, DOM или Node-specific API.
2. Multiplayer server authoritative.
3. Solo и multiplayer используют одни gameplay rules.
4. Client отправляет intents/commands, а не authoritative state.
5. Rendering state отделён от simulation state.
6. Network replication отделён от simulation state.
7. Gameplay time основано на fixed tick.
8. Gameplay randomness проходит через seeded RNG abstraction.
9. Ownership и control — разные понятия.
10. Objectives не hardcode под один Sacred Tree.
11. Database не добавляется без persistent use case.
12. React не управляет per-frame transforms игровых entities.
13. Colyseus Room не является simulation core.
14. Turborepo — repository tooling, не runtime dependency игры.
15. Оптимизация выполняется после измерений, если spec не требует обратного.

## 6. Monorepo/tooling

Базовый stack:

- pnpm workspaces;
- Turborepo;
- TypeScript strict;
- Vite + React;
- Babylon.js;
- Node.js + Colyseus;
- Vitest;
- Playwright;
- Docker Compose;
- GitHub Actions.

Основные root commands:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Если команда отсутствует в ранней scaffold-задаче, текущая задача должна добавить её только если это входит в acceptance criteria.

## 7. Package boundaries

Целевая структура foundation:

```text
apps/
  web/
  game-server/

packages/
  simulation/
  protocol/
  game-data/
  testkit/

tools/
  bot-client/
  scenario-runner/
```

Не создавать новый package, если понятие нормально живёт внутри существующего package.

Public API packages должен быть минимальным и явным.

## 8. Simulation rules

В gameplay/simulation коде запрещены прямые вызовы:

- `Date.now()`;
- `performance.now()`;
- `setTimeout()` как gameplay timer;
- `Math.random()`.

Simulation получает время через tick/config, randomness — через RNG abstraction.

Предпочитать data-oriented composition вместо глубокого class inheritance.

Не вводить сторонний ECS framework без ADR.

## 9. Network rules

- Runtime input validation обязательна для client commands.
- Не доверять `playerId`/ownership данным из client payload, если identity доступна из session.
- Проверять controller/permissions server-side.
- Malformed command не должен валить room/process.
- Protocol breaking change требует изменения `protocolVersion` или явного решения в spec.

## 10. Client rules

- Babylon.js отвечает за presentation, не за gameplay authority.
- React отвечает за web UI/HUD/lobby, не за scene graph entities.
- Client game flow работает через `GameTransport` boundary.
- Не импортировать Colyseus напрямую глубоко в gameplay/presentation; SDK должен быть изолирован в remote transport/network adapter.

## 11. Tests и CI

Каждая implementation-задача должна добавлять/обновлять тесты на своё поведение.

Минимальные уровни по необходимости:

- unit tests;
- simulation scenario tests;
- server integration tests;
- Playwright E2E.

Bug fix должен иметь regression test, если это практически возможно.

Не удалять/ослаблять существующий тест только для прохождения CI без объяснённой причины.

Локальные проверки необходимы, но не являются достаточным доказательством completion. Перед финальным review все required GitHub Actions checks для PR должны завершиться успешно. Агент не должен объявлять PR готовым, опираясь только на локальный вывод команд.

## 12. Branch freshness

Перед финальным review/передачей PR агент должен:

1. выполнить `git fetch origin`;
2. проверить, не отстаёт ли task branch от `origin/main`;
3. если `main` продвинулся и PR ещё не проверялся поверх нового состояния — rebase/update branch на актуальный `origin/main`;
4. после rebase повторно прогнать релевантные локальные проверки и дождаться нового GitHub Actions run.

Конфликты разрешать внутри task worktree. После rebase собственной ветки использовать только `git push --force-with-lease`.

## 13. PR requirements

PR должен содержать:

- ссылку на issue/spec;
- краткое описание реализации;
- список проверенных acceptance criteria;
- выполненные команды/tests;
- architectural impact (`none` допустимо);
- известные ограничения/TODO только если они находятся вне scope.

PR должен быть небольшим и reviewable. Не объединять несколько независимых foundation issues в один PR без явной причины.

Coding agent не merge'ит собственный PR и не включает auto-merge. Merge выполняется пользователем/maintainer после review и required CI checks.

## 14. Changes requiring ADR first

Не начинать реализацию, если задача требует без существующего решения:

- сменить authoritative networking model;
- заменить Babylon.js;
- заменить Colyseus;
- изменить boundary simulation/network/presentation;
- добавить database/Redis;
- добавить новый runtime service;
- заменить fixed timestep model;
- внедрить ECS framework;
- изменить transport abstraction;
- сделать client источником hidden/full authoritative state.

Сначала ADR/spec, затем код.

## 15. Definition of completion for an agent task

Задача не завершена, пока:

- acceptance criteria не выполнены;
- код typechecks;
- релевантные tests green;
- build green;
- required GitHub Actions checks green;
- branch проверена поверх актуального `main`, если `main` изменился во время работы;
- docs обновлены, если public contract изменился;
- PR не содержит случайного scope expansion;
- PR остаётся unmerged до решения пользователя/maintainer.
