# Agentic workflow

Этот документ задаёт роли и handoff между обычным task-chat в пространстве Web RTS и отдельным coding agent.

Он не заменяет `AGENTS.md`: `AGENTS.md` остаётся контрактом для coding agent, который непосредственно изменяет repository.

## Роли

### Task Chat / Orchestrator

Обычный task-chat в пространстве Web RTS по умолчанию выполняет роль orchestrator / planner / reviewer.

Он должен:

1. проверить актуальный GitHub repository и `main`;
2. прочитать `docs/project-status.md`, релевантные Vision/ADR/spec и текущий GitHub Issue;
3. прочитать `AGENTS.md` и `.agents/skills/web-rts-router/SKILL.md`, чтобы понимать ограничения будущей implementation;
4. изучить актуальный код на `main`;
5. уточнить scope, зависимости, риски и acceptance criteria;
6. сформировать implementation plan;
7. подготовить готовый prompt для отдельного coding agent;
8. после реализации проверить фактический PR, exact head, diff, branch freshness и GitHub Actions;
9. провести review и сформулировать замечания для coding agent;
10. повторять review после fixes до готовности к manual merge;
11. завершать финальное review обязательным `Project Status Check: Required / Not required` с кратким обоснованием; при `Required` запросить обновление в том же PR до merge и повторить review.

По умолчанию Task Chat **не**:

- создаёт implementation branch/worktree;
- изменяет runtime/tooling/gameplay files;
- коммитит implementation;
- открывает implementation PR;
- выполняет issue вместо отдельного coding agent.

Самостоятельная implementation обычным Task Chat разрешена только по явной команде пользователя, например: `реализуй сам`, `сделай PR сам`, `внеси изменения самостоятельно` или эквивалентной по смыслу.

Если такого разрешения нет, после planning Task Chat должен остановиться на готовом prompt/handoff для coding agent.

### Coding Agent

Coding Agent — отдельный implementation context, которому Task Chat передаёт подготовленную задачу.

Coding Agent:

1. следует `AGENTS.md`;
2. работает по правилу `1 task/issue = 1 branch = 1 worktree = 1 PR`;
3. создаёт task branch от актуального `origin/main`;
4. реализует только scope текущей issue/spec;
5. запускает релевантные tests/build/verification;
6. открывает PR;
7. исправляет замечания review;
8. перед передачей PR выполняет `Project Status Check: Required / Not required`, фиксирует обоснование в PR и обновляет `docs/project-status.md` при `Required`;
9. не merge'ит PR и не включает auto-merge.

### Naming / handoff contract

При подготовке implementation prompt Task Chat обязан явно передать Coding Agent:

```yaml
Task: G4c / #87
Branch: feature/g4c-87
Worktree: web-rts_g4c-87
Base: origin/main
```

Точные имена определяются Task Chat по правилам `AGENTS.md`: branches — `feature|fix|doc|chore/<stage>-<issue>[-description]`, `<type>/<issue>[-description]` или `<type>/<description>`; worktrees — `web-rts_<stage>-<issue>`, `web-rts_<issue>` либо `web-rts_<type>_<description>` без issue. Stage берётся из issue/spec. С issue тип и описание **не** включаются в имя worktree. Все части lowercase, описания в kebab-case.

Перед созданием новых branch/worktree Coding Agent проверяет, нет ли уже существующих для этой же задачи. Начиная с даты принятия правил, новые имена соблюдают контракт; старые ветки и worktree не переименовываются. GitHub Actions `branch-name` входит в required `ci-gate` на PR и блокирует merge при несоблюдении naming convention, но не создание ветки.

### Project Status Check (обязательный финальный review gate)

Перед сдачей PR Coding Agent, а в конце каждого финального review Task Chat / архитектор независимо фиксируют **одно** решение с кратким обоснованием:

- `Required` — PR меняет крупный stage/checkpoint, milestone/roadmap, зависимости этапов, устойчивые project-wide invariants или агентный workflow contract. Обновить `docs/project-status.md` **в этом же PR**, затем повторно проверить diff и GitHub Actions.
- `Not required` — PR не меняет checkpoint (например, локальный bugfix, тесты или внутренний рефакторинг). Обосновать отсутствие обновления.

Не вносить в checkpoint текущие SHA, временные CI statuses или transient PR states. `Required` означает блокировку передачи PR на manual merge до обновления, а не обязанность менять файл в каждом PR.

### User / Maintainer

Пользователь принимает продуктовые и архитектурные решения, при необходимости корректирует scope и вручную merge'ит PR после review и required CI.

## Default interpretation запросов

В обычном Task Chat короткие команды вида:

- `Делаем F9, issue #14. Начинай.`
- `Берём issue #15.`
- `Давай следующую задачу.`

по умолчанию означают:

> восстановить актуальный context из repository/GitHub → изучить задачу → спланировать implementation → подготовить готовый prompt для Coding Agent.

Они **не являются разрешением самостоятельно менять repository**.

Если пользователь присылает уже открытый implementation PR, Task Chat переключается в reviewer mode: независимо проверяет актуальный PR head, diff и CI и не полагается только на отчёт coding agent.

## Workflow одной implementation-задачи

```text
Task Chat
  research + planning
        ↓
готовый prompt
        ↓
Coding Agent
  branch + worktree + implementation + tests
        ↓
PR + GitHub Actions
        ↓
Task Chat
  independent review actual PR/CI
        ↓
Coding Agent fixes (если нужны)
        ↓
Task Chat final review
        ↓
User manual merge
```

Для каждой самостоятельной issue предпочтителен отдельный Task Chat. Architecture/roadmap discussion может жить в отдельном общем чате проекта.

## Bootstrap нового Task Chat

Перед planning новой задачи Task Chat должен:

1. открыть актуальный repository `https://github.com/Web-Usov/web-rts`;
2. проверить актуальный `main`, а не использовать сохранённый SHA;
3. прочитать этот документ;
4. прочитать `docs/project-status.md`;
5. прочитать `AGENTS.md` и `.agents/skills/web-rts-router/SKILL.md` как ограничения для Coding Agent;
6. прочитать релевантные Game Vision / Technical Vision / ADR / spec;
7. прочитать текущий GitHub Issue;
8. проверить актуальный код на `main`.

Если работа продолжается после отчёта Coding Agent, Task Chat дополнительно обязан проверить фактический PR, exact head и GitHub Actions непосредственно в GitHub.

## Source of truth

История чата, memory/summary, старые SHA и отчёты coding agents — только вспомогательный контекст.

Для текущего состояния проекта источником истины являются актуальный repository, GitHub Issues, PR и GitHub Actions. Архитектурный приоритет документов остаётся определён в `AGENTS.md`.
