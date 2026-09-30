# Project status

Этот файл — компактный checkpoint для нового task/chat/agent context. Он помогает быстро понять, где находится проект, но **не заменяет** Game Vision, Technical Vision, ADR, spec или GitHub Issues.

## Как использовать

Для нового обычного Task Chat:

1. прочитать `docs/agentic-workflow.md` и определить свою роль как orchestrator / planner / reviewer;
2. прочитать этот checkpoint;
3. получить актуальное состояние `main`, PR и GitHub Actions из GitHub;
4. прочитать `AGENTS.md` и `.agents/skills/web-rts-router/SKILL.md` как ограничения для отдельного Coding Agent;
5. прочитать релевантные Game Vision / Technical Vision / ADR / spec / issue;
6. проверить актуальный код на `origin/main` перед планированием реализации;
7. подготовить implementation plan и готовый prompt для Coding Agent.

Обычный Task Chat не выполняет implementation самостоятельно, если пользователь явно не попросил `реализуй сам`, `сделай PR сам` или эквивалентное действие. Короткая команда вида `Делаем F9, issue #14. Начинай` означает planning + handoff Coding Agent, а не самостоятельное изменение repository.

Coding Agent, получивший handoff, следует `AGENTS.md` и правилу `1 task/issue = 1 branch = 1 worktree = 1 PR`.

История предыдущего чата, summary предыдущей agent session и финальный отчёт coding agent могут использоваться как вспомогательный контекст, но не считаются доказательством актуального состояния репозитория, PR или CI.

Этот файл намеренно **не хранит текущий SHA `main`, состояние PR или CI checks**: такие данные быстро устаревают и должны читаться напрямую из GitHub.

## Foundation checkpoint

Завершены:

- F0 — Repository/tooling scaffold (#4);
- F1 — Simulation kernel + fixed tick + scenario tests (#5);
- F2 — Babylon client shell + camera + primitive map (#6);
- F3 — Protocol contracts + `GameTransport` (#7);
- F4 — Colyseus server + room lifecycle (#9);
- F5 — Replication + primitive movement (#10);
- F6 — Owner/Controller + generic Sacred Site objective (#11);
- F7 — Multiplayer browser E2E (#12);
- F8 — Reconnect (#13).

Следующие открытые foundation stages:

- [F9 — Docker/LAN startup](https://github.com/Web-Usov/web-rts/issues/14);
- [F10 — Debug/performance instrumentation](https://github.com/Web-Usov/web-rts/issues/15);
- [F11 — LocalGameTransport/WebWorker skeleton](https://github.com/Web-Usov/web-rts/issues/16).

GitHub Issues остаются источником implementation scope и acceptance criteria. Этот список нужен только как быстрый navigation checkpoint.

## Устойчивые архитектурные опорные точки

- multiplayer server authoritative;
- `packages/simulation` не зависит от React, Babylon.js, Colyseus, DOM или Node-specific API;
- client отправляет intents/commands, а не authoritative state;
- simulation работает на fixed tick и seeded RNG;
- Babylon.js отвечает только за presentation;
- Colyseus изолирован за `GameTransport` / remote transport boundary;
- replication отделена от simulation state;
- Owner и Controller — разные simulation concepts;
- objectives generic, renderer не hardcode конкретный objective entity id;
- browser multiplayer smoke является required full-CI частью через `browser-e2e` → `ci-gate`;
- reconnect foundation policy: 30 секунд grace для unexpected drop/reload, explicit Disconnect permanent, terminal leave снимает Controller и сохраняет entity/Owner.

Полные правила и детали находятся в `docs/agentic-workflow.md`, `AGENTS.md`, `docs/technical-vision.md`, `docs/adr/` и `docs/specs/`.

## Когда обновлять этот файл

Обновлять checkpoint, когда materially меняется один из пунктов:

- завершён/добавлен крупный foundation stage;
- изменился ближайший roadmap;
- появился новый устойчивый project-wide invariant или workflow contract.

Не обновлять его после каждого commit/PR только ради SHA, CI status или мелкой реализации — для этого существует GitHub history.
