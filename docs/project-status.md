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
- F8 — Reconnect (#13);
- F9 — Docker/LAN startup (#14);
- F10 — Debug/performance instrumentation (#15);
- F11 — LocalGameTransport/WebWorker skeleton (#16).

Следующие открытые foundation stages:

- нет. Foundation Spec #001 в части F0–F11 закрыт. Новый stage начинается только с отдельного issue/spec.

GitHub Issues остаются источником implementation scope и acceptance criteria. Этот список нужен только как быстрый navigation checkpoint.

## Gameplay Spec #002 checkpoint

Текущий milestone — **Gameplay Spec #002: First Economy & Defense Vertical Slice** (#50).

Architecture/spec phase завершена: Art Direction #48/#49 и Gameplay Spec #002/ADR changes из PR #52 уже merged в `main`. Статус #002 — **ACCEPTED / implementation in progress**.

Implementation checkpoint:
- G1 / #54 — completed (PR #73);
- G2 / #55 — completed (PR #74);
- G3 / #56 — completed (PR #76);
- **current gameplay stage: G4a / #57 — Deterministic navigation / MOVE core**.

Art Direction дополнительно уточнён через #75 / PR #77: основной production-style target — **Stylized Low-Poly / Soft Hand-Painted**.

GitHub epic #50 является актуальным tracker implementation decomposition. Архитектурные G4 и G12 остаются логическими stages в Spec, но фактическая реализация разделена на небольшие reviewable PR:

```text
#54 G1 Shared MatchRuntime / host hardening ✅
 ├─ #55 G2 Session/input hardening ✅
 └─ #56 G3 Entity/Objective/Map spatial foundation ✅
       ↓
     #57 G4a Navigation / MOVE core ← CURRENT
       ├─ #68 G4b Fair scheduling / path budgets
       └─ #69 G4c Breach-aware planner
            ↓
       #58 G5 Economy  ||  #59 G6 Combat
            ↓
          #60 G7 Construction
          ├─ #61 G8 Garrison
          └─ #62 G9 PvE AI (также требует #69)
               ↓
             #63 G10 Wave / Defeat
               ↓
             #64 G11 Protocol / Replication
               ↓
             #65 G12a Presentation cleanup
               ↓
             #70 G12b Interaction controls
               ↓
             #71 G12c HUD / state feedback
               ↓
             #66 G13 Art Direction target
               ↓
             #67 G14 Full Local/Remote E2E
```

G1–G3 уже завершены. Сейчас следующий обязательный stage — #57 G4a. После #57 можно параллельно запускать #68 G4b и #69 G4c; после #68 — #58 G5 и #59 G6. Практический максимум остаётся **2 Coding Agents одновременно**.

Критические границы decomposition:

- G1 создаёт shared MatchRuntime и только **структуру** per-player queues;
- G2 добавляет ingress caps, `maxPendingCommandsPerPlayer`, `queue_full`, rate/size hardening и room lock;
- G4b добавляет deterministic fair scheduling и path budgets;
- LOBBY / join / reconnect / room lock остаются shell-owned согласно ADR-009; общий session manager не вводится;
- Local/Remote parity касается gameplay bootstrap/execution/projection и observable `START → RUNNING → FINISHED` semantics.

Audit #53 остаётся review/verification record. Его исходный текст фиксирует состояние Foundation на момент аудита; текущий implementation contract задают accepted Spec/ADR и child issues #54–#71.

## Устойчивые архитектурные опорные точки

- multiplayer server authoritative;
- `packages/simulation` не зависит от React, Babylon.js, Colyseus, DOM или Node-specific API;
- client отправляет intents/commands, а не authoritative state;
- simulation работает на fixed tick и seeded RNG;
- Babylon.js отвечает только за presentation;
- Colyseus изолирован за `GameTransport` / remote transport boundary;
- `/?transport=local` исполняет ту же shared simulation в WebWorker через `LocalGameTransport`; обычный `/` остаётся `RemoteGameTransport`; presentation не ветвится по режиму;
- replication отделена от simulation state;
- Owner и Controller — разные simulation concepts;
- objectives generic, renderer не hardcode конкретный objective entity id;
- browser multiplayer smoke является required full-CI частью через `browser-e2e` → `ci-gate`;
- Docker/LAN smoke является required full-CI частью через `docker-lan-smoke` → `ci-gate`; docs-only PR по-прежнему пропускает тяжёлые jobs;
- LAN client без явного URL подключается к hostname страницы и опубликованному порту game-server, а не к hardcoded `localhost`;
- reconnect foundation policy: 30 секунд grace для unexpected drop/reload, explicit Disconnect permanent, terminal leave снимает Controller и сохраняет entity/Owner;
- development debug overlay и Babylon Inspector включены только при Vite `import.meta.env.DEV` (`pnpm dev`, Playwright); production `vite build` их не активирует, lobby/connect UI остаётся;
- foundation logging считает `matchId = roomId` (один match lifecycle на Room); verbose per-tick duration logs выключены при `NODE_ENV=production`, в test и в CI, пока явно не задан `TICK_DIAGNOSTICS_LOG=1`.

Полные правила и детали находятся в `docs/agentic-workflow.md`, `AGENTS.md`, `docs/technical-vision.md`, `docs/adr/` и `docs/specs/`.

## Когда обновлять этот файл

Обновлять checkpoint, когда materially меняется один из пунктов:

- завершён/добавлен крупный foundation stage;
- изменился ближайший roadmap;
- появился новый устойчивый project-wide invariant или workflow contract.

Не обновлять его после каждого commit/PR только ради SHA, CI status или мелкой реализации — для этого существует GitHub history.
