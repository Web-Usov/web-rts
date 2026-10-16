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

## Agentic workflow checkpoint

- Для новых implementation-задач действует naming contract из `AGENTS.md`: branch prefix `feature/`, `fix/`, `doc/` или `chore/`; отдельный worktree `web-rts_...`. Для задач с issue worktree не включает тип/описание; orchestrator передаёт точные имена и `origin/main` в handoff.
- PR branch naming контролируется GitHub Actions `branch-name` через required `ci-gate`; создание/push ветки само по себе не блокируется. Ранее созданные ветки не переименовываются.
- Каждый Coding Agent перед handoff и Task Chat / architect reviewer в конце финального review делают `Project Status Check: Required / Not required`. При `Required` checkpoint обновляется в том же PR **до** manual merge; мелкие PR не требуют формальных правок файла.

- AT8 / #108 — опциональный `web-rts-feedback-loop` route для defect/regression с headless-детектором (`.agents/skills/web-rts-feedback-loop/`, `scripts/agent-loop-summary.mjs`); не входит в обязательный bootstrap. Pilot A/B (n=1) не показал экономии токенов/времени — решение Iterate: [verification/108](verification/108-coding-agent-feedback-loop/README.md).

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
- G4a / #57 — completed (PR #81): deterministic navigation / MOVE core;
- G4b / #68 — completed (PR #84): fair command scheduling / path budgets;
- G4c / #69 — completed (PR #83): deterministic breach-aware planner;
- G5 / #58 — completed: finite Wood, Worker carry и повторяющийся internal GATHER, owned Town Hall drop-off, PlayerEconomy и transport-neutral snapshots/events;
- G7 / #60 — completed: internal BUILD NEW/EXISTING, same-owner resumable Construction, canonical Worker reservation, Wall topology и completed Tower shell; BUILD wire/UI остаётся G11/G12.
- **next gameplay stages: G8 / #61 (Garrison) и G9 / #62 (PvE AI)**; G7 prerequisites реализованы. Public economy/GATHER/Construction projection остаётся G11, interaction/HUD — G12.
- G6 / #59 — completed: match-level Team/relationships, tick-based Health/Attack/death, стартовый melee Soldier с bounded auto-aggro/chase и explicit MOVE override;
- G5 и G6 интегрированы в shared MatchRuntime: economy hooks и combat используют один ascending-entityId pass, общие movement/navigation и active-task lane.

Art Direction дополнительно уточнён через #75 / PR #77: основной production-style target — **Stylized Low-Poly / Soft Hand-Painted**.

GitHub epic #50 является актуальным tracker implementation decomposition. Архитектурные G4 и G12 остаются логическими stages в Spec, но фактическая реализация разделена на небольшие reviewable PR:

```text
#54 G1 Shared MatchRuntime / host hardening ✅
 ├─ #55 G2 Session/input hardening ✅
 └─ #56 G3 Entity/Objective/Map spatial foundation ✅
       ↓
     #57 G4a Navigation / MOVE core ✅
       ├─ #68 G4b Fair scheduling / path budgets ✅
       └─ #69 G4c Breach-aware planner ✅
            ↓
       #58 G5 Economy ✅  ||  #59 G6 Combat ✅
            ↓
          #60 G7 Construction ✅
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

G1–G7 завершены. Следующие gameplay stages — G8 (#61), Garrison, и G9 (#62), PvE AI. Для G9 дополнительно требуется уже завершённый G4c (#69). Практический максимум остаётся **2 Coding Agents одновременно**.

Follow-up #87 завершён в PR #92: blocked-target resolution переиспользует topology-revision component labels и command-scoped target resolution. #82 — UX обратной связи для скорректированной MOVE destination — остаётся вне критического пути; он не отменяет завершённый контракт G4.

Параллельный art track: #80 — Core #002 Visual Pack для Worker, Soldier, зданий и Sacred Site; визуальным источником истины остаётся `docs/art-direction.md`. Это подготовка к G13 (#66), не самостоятельное расширение gameplay scope.

Критические границы decomposition:

- G1 создаёт shared MatchRuntime и только **структуру** per-player queues;
- G2 добавляет ingress caps, `maxPendingCommandsPerPlayer`, `queue_full`, rate/size hardening и room lock;
- G4b добавляет deterministic fair scheduling и path budgets;
- LOBBY / join / reconnect / room lock остаются shell-owned согласно ADR-009; общий session manager не вводится;
- Local/Remote parity касается gameplay bootstrap/execution/projection и observable `START → RUNNING → FINISHED` semantics.

Audit #53 остаётся review/verification record. Его исходный текст фиксирует состояние Foundation на момент аудита; текущий implementation contract задают accepted Spec/ADR и child issues #54–#71.

## Самостоятельный client UX checkpoint

- C1 / #96 — RTS Camera Controls v1: самостоятельный этап после G7 и до G8/G9, вне gameplay scope #002. Четыре yaw-ракурса, экранный keyboard/edge/drag pan, cursor-anchored wheel zoom и focus-safe input остаются presentation-only; camera policy зафиксирована в Art Direction §11.
- C1 не добавляет зависимостей для G8/G9 и не требует G11/G12. G12b (#70) учитывает зарезервированные R/F/Q/E и gesture arbitration; G12a (#65) сможет передать replicated mapId extent в controller без изменения camera math; G13 (#66) проверяет art на normal/strategic zoom.

## Устойчивые архитектурные опорные точки

- multiplayer server authoritative;
- `packages/simulation` не зависит от React, Babylon.js, Colyseus, DOM или Node-specific API;
- client отправляет intents/commands, а не authoritative state;
- simulation работает на fixed tick и seeded RNG;
- Team не выводится из Owner/Controller: authoritative PlayerId → TeamId и симметричная match-level policy определяют FRIENDLY/NEUTRAL/HOSTILE;
- Soldier auto-combat и MOVE replans расходуют одну active-task lane в ascending entityId order, максимум одна path query/entity/tick; stats находятся в game-data;
- первый combat strike происходит на первом eligible tick, повторный — не раньше strikeTick + cooldownTicks; lethal damage сразу удаляет active entity/footprint, generic Objective сохраняется до G10;
- стартовый Soldier дополняет foundation_unit в общем Local/Remote bootstrap; Health/Team/task snapshot остаётся внутренним до G11, public protocol и final combat UI не добавлены;
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

## Agent Tooling checkpoint

Самостоятельное направление **AT — Agent Tooling / AI Development Infrastructure**: [Epic #100](https://github.com/Web-Usov/web-rts/issues/100), [Spec #003](specs/003-agent-tooling-and-verification.md). Оно не расширяет gameplay G* или art scope.

- AT1 / [#98](https://github.com/Web-Usov/web-rts/issues/98) завершён: headless MOVE/combat verification и JSON evidence; ограничения и reproduction — в [экспериментальном отчёте](verification/98-gameplay-harness/README.md).
- AT0 / [#101](https://github.com/Web-Usov/web-rts/issues/101) завершён: architecture/spec и ADR gate; отдельный ADR пока не нужен при сохранении принятых boundaries.
- AT2 / [#102](https://github.com/Web-Usov/web-rts/issues/102) завершён: verified engineering notes и offline `kb index/search/show/check`, selective retrieval и лёгкую CI validation. Маршрут: [Knowledge Base](knowledge/README.md); measured pilot и ограничения: [AT2 verification](verification/102-agent-knowledge-base/README.md). Notes не заменяют текущий GitHub/код и Vision/ADR/spec; вся база в контекст не загружается.
- AT3 / [#103](https://github.com/Web-Usov/web-rts/issues/103) завершён: Gameplay Verification v2: checked-in JSON scenarios, reviewed fixture registry, intermediate checkpoints, bounded trace и строгая input validation поверх AT1. CLI: `pnpm verify:gameplay --list`, `move`, `combat`, `permanent-leave`, `--json JSON`; report schemaVersion 1 и exit 0/1/2 сохранены. Reproduction, schema, measured repeats/negative proofs и ограничения — в [AT3 verification report](verification/103-gameplay-verification-v2/README.md).
- AT4 / [#104](https://github.com/Web-Usov/web-rts/issues/104) завершён: opt-in `pnpm verify:mutation` в disposable commit-pinned worktrees, явный каталог из трёх gameplay mutations, baseline/rebuild/detector/cleanup evidence. Строгий режим отвергает survivors и setup errors; deliberate targetability survivor фиксирует пробел узкого AT3 Combat oracle. Инструмент — `tools/scenario-runner/src/mutation-cli.ts`; результаты, стоимость и ограничения — в [AT4 verification report](verification/104-mutation-verification/README.md). Mutation matrix не включена в required CI.
- AT5 / [#105](https://github.com/Web-Usov/web-rts/issues/105) — 2D/reference/texture provenance и QA; AT6 / [#106](https://github.com/Web-Usov/web-rts/issues/106) — GLB validation/Mesh Studio handoff после AT5 и готовности нужного API.
- AT7 / [#107](https://github.com/Web-Usov/web-rts/issues/107) завершён: `pnpm verify:browser` поверх существующего Playwright/UI проверяет MOVE в Local WebWorker и двух Remote contexts, UI запрет чужого управления и bounded JSON/screenshots/trace/video evidence. Поддерживается semantic parity с AT3; exact seed/tick/world-target replay через текущий UI недоступен. Повторы, controlled FAIL, camera regressions и ограничения — в [AT7 verification report](verification/107-browser-gameplay-replay/README.md). Production trust boundary не расширена; BUILD/combat UI зависит от G11/G12.
- AT8 / [#108](https://github.com/Web-Usov/web-rts/issues/108) — measured Coding Agent feedback loop после AT2/3/4/7.
- AT9 / [#109](https://github.com/Web-Usov/web-rts/issues/109) — conditional public-protocol bot/soak после AT7, только при доказанном gap existing tests.

Stage gates и stop/go описаны в Spec #003; текущие scope/acceptance criteria и готовность зависимостей проверяются по Issues/main. AT5/AT6/AT8/AT9 не считаются реализованными по наличию этого checkpoint.
