# Spec #003 — Agent tooling and verification

Статус: **ACCEPTED — implementation track planned**. Implementation tracker: [Epic #100](https://github.com/Web-Usov/web-rts/issues/100), [AT0 #101](https://github.com/Web-Usov/web-rts/issues/101). AT0 содержит только документацию; AT2 предоставляет [Knowledge Base](../knowledge/README.md) с [retrieval pilot](../verification/102-agent-knowledge-base/README.md); AT3 предоставляет [scenario files, checkpoints и измеренный эксперимент](../verification/103-gameplay-verification-v2/README.md); AT4 предоставляет [opt-in targeted mutation matrix и cleanup evidence](../verification/104-mutation-verification/README.md); AT7 предоставляет [Playwright MOVE Local/Remote, semantic parity и bounded browser evidence](../verification/107-browser-gameplay-replay/README.md); AT5/AT6/AT8/AT9 ниже — будущие интерфейсы и эксперименты, а не реализованные инструменты.

## 1. Цель и навигация

AT должен помогать Coding Agent воспроизводить реальные ошибки, проверять исправления и передавать проверяемое evidence независимому reviewer. Заимствуются отдельные инженерные практики, а не второй engine или reverse-engineering stack. Новые gameplay mechanics, database/vector service, LLM runtime, autonomous merge и переписывание Babylon.js/Colyseus вне scope.

Контракт работы и source-of-truth hierarchy: [AGENTS.md](../../AGENTS.md), роли/handoff: [agentic-workflow](../agentic-workflow.md), текущий navigation checkpoint: [project-status](../project-status.md). Продуктовые границы: [Game Vision](../game-vision.md); visual/asset задачи дополнительно читают [Art Direction](../art-direction.md). Тестовые слои, CI и security: [Technical Vision §32–36](../technical-vision.md#32-testing-strategy), gameplay coverage: [Spec #002 §27](002-first-economy-defense-vertical-slice.md#27-automated-testing-direction).

Практический маршрут: stage в §2 → boundary/ADR в §3 → experiment/evidence в §4 → walkthrough §7 или §8. Не требуется читать все specs, KB или skills при каждой задаче; обязательный bootstrap из AGENTS.md сохраняется.

## 2. Этапы и переходы

Приоритет задаёт порядок выбора готовых задач, но не отменяет prerequisites. Каждый implementation stage — отдельные issue/branch/worktree/PR. Максимум параллельной работы берётся из актуального project-status; эта spec не вводит новый orchestrator.

| Stage / issue | Приоритет | Назначение / prerequisites | Exit gate для дальнейшего использования |
| --- | --- | --- | --- |
| AT0 [#101](https://github.com/Web-Usov/web-rts/issues/101) | P0 | Эта spec, ADR decision, checkpoint; без prerequisites | Два walkthrough согласованы с кодом/ADR, ссылки проверены, независимый review |
| AT1 [#98](https://github.com/Web-Usov/web-rts/issues/98) | P0 | Исходный headless oracle; завершён в [PR #99](https://github.com/Web-Usov/web-rts/pull/99) | MOVE/combat outcomes, repeatability и ручная mutation; ограничения в [отчёте](../verification/98-gameplay-harness/README.md) |
| AT2 [#102](https://github.com/Web-Usov/web-rts/issues/102) | P0 | Searchable KB; после принятого AT0 | ≥3 проверенных notes; два сравнимых retrieval упражнения, schema/secret/stale/no-result negatives; полезность измерена |
| AT3 [#103](https://github.com/Web-Usov/web-rts/issues/103) | P0/P1 | Scenario files/checkpoints; AT0 + merged AT1 | Два перенесённых fixtures + реальный regression, ≥5 повторов каждого, wrong intermediate check найден; invalid input не PASS |
| AT4 [#104](https://github.com/Web-Usov/web-rts/issues/104) | P1 | Opt-in targeted mutation matrix; AT3 | ≥3 mutations, включая survivor/weak oracle, выбранные повторы дважды, setup failure и cleanup доказаны; measured cost до required CI |
| AT5 [#105](https://github.com/Web-Usov/web-rts/issues/105) | P1 | 2D/reference/texture processing; AT0, coordination с [art #80](https://github.com/Web-Usov/web-rts/issues/80) | Два реальных local outputs, provenance/QA negatives и preview; generation реально проверена либо явно blocked ресурсами |
| AT6 [#106](https://github.com/Web-Usov/web-rts/issues/106) | P1 | GLB validation/handoff; AT0 + AT5 + зрелый нужный Mesh Studio API [#85](https://github.com/Web-Usov/web-rts/issues/85)/[#86](https://github.com/Web-Usov/web-rts/pull/86) | Реальный GLB, import/preview, broken asset negative, сравнение с manual baseline и доказанные права/стоимость; stop/go §6 |
| AT7 [#107](https://github.com/Web-Usov/web-rts/issues/107) | P1 | Browser Local/Remote replay/observation; AT3 | Headless + Local + два Remote clients, повторяемые positive/negative observations, console checks; camera flake diagnosed либо честный unresolved repro |
| AT8 [#108](https://github.com/Web-Usov/web-rts/issues/108) | P1 | Coding Agent feedback loop; AT2/3/4/7 | Реальный failure → diagnosis → fix → retest, comparison с baseline, handoff без chat history; допустим ранний headless-only pilot, без claims full browser support |
| AT9 [#109](https://github.com/Web-Usov/web-rts/issues/109) | P2, conditional | Public-protocol bot/soak; AT7 + доказанный gap + проверка G11 | Go/no-go до реализации; при go — два clients, soak/reconnect и bad/drop negative, runtime/CPU/errors; stop/go §6 |

AT2, AT3 и AT5 независимы после своих gates; AT6 не копирует непринятый Mesh Studio API. AT7 начинает с MOVE; расширение BUILD/combat UI требует [G11 #64](https://github.com/Web-Usov/web-rts/issues/64), [G12b #70](https://github.com/Web-Usov/web-rts/issues/70) и [G12c #71](https://github.com/Web-Usov/web-rts/issues/71) в соответствующем scope. Завершённость dependency проверяется по актуальному GitHub/main, а не по этой таблице. Exit gate не заменяет acceptance criteria связанного issue или AGENTS.md Definition of completion.

## 3. Границы и решение по ADR-010

| Область | Допустимая ответственность | Запрещённый обход |
| --- | --- | --- |
| Production simulation / MatchRuntime | Единственные gameplay rules, explicit fixed step, seeded RNG, trusted actor отдельно от intent; snapshot/events/metrics | Framework/DOM/Node dependency в simulation, test-specific gameplay rules |
| `packages/testkit` | Trusted fixture builders, assertions и reference runs; World setup для низкоуровневых tests | Доступ browser/client к mutable World; production импорт testkit |
| `tools/scenario-runner` | Выбор/валидация fixture, выполнение через runtime/testkit, bounded JSON evidence и exit codes | Arbitrary eval сценария из внешнего JSON; второй gameplay implementation |
| Browser automation | Playwright + public UI/GameTransport + существующий server harness; recipient-visible observations | Подмена session actor, hidden enemy state, bypass command validation или отдельный authoritative runtime |
| Knowledge base | `docs/knowledge/`: compact sourced notes + deterministic bounded index/search | Notes как новый source of truth, secrets/PII, full KB injection, обязательные embeddings/LLM/cloud |
| Asset pipeline | Offline processing/QA, существующий manifest/validator, reviewable previews | Автозамена accepted originals, auto-promotion в G13, gameplay side effects или дублирование Mesh Studio |

Принятые решения уже покрывают AT: [ADR-004](../adr/004-fixed-timestep-and-repeatable-simulation.md) — repeatability одного runtime/version; [ADR-006](../adr/006-local-vs-remote-game-transport.md) — GameTransport; [ADR-007](../adr/007-replication-boundary-and-visibility.md) — recipient projection/hidden state; [ADR-009](../adr/009-shared-match-runtime-and-adapter-boundary.md) — shared MatchRuntime и единственный production bridge `match-adapter`. Testkit может использовать этот bridge в reference test, но не становится вторым production path.

**ADR-010 сейчас не создаётся:** AT0 не принимает новую runtime boundary, сервис или transport contract. Fixtures, Markdown retrieval и offline QA остаются development tooling внутри существующей архитектуры. Новый ADR обязателен **до реализации**, если потребуется test-only browser control/diagnostics API через production trust boundary, новый runtime service/database, изменение simulation/network/presentation или transport abstraction, client access к privileged state. ADR должен определить isolation/build exclusion, данные/identity, threat model, альтернативы и негативное доказательство отсутствия production exposure. Даже «только debug» не освобождает от gate. Без ADR unsafe route отклоняется; используются существующие public flows, а недоступная parity отмечается unsupported.

## 4. Проверяемые эксперименты и evidence

Каждый stage заранее фиксирует вопрос, baseline, supported scope, команды, ожидаемый positive outcome и negative detector. Одинаковый результат двух запусков не доказывает правильность: нужны независимые expected state/event/rejection. Negative expectation проверяет oracle, corrupted observation — его sensitivity, gameplay mutation — способность поймать конкретный defect; эти три доказательства не взаимозаменяемы.

Повторы выполняются на одном code/runtime/config/seed/ordered-input set; записываются версия Node/pnpm, commit, fixture и environment. Порядок команд значим. Wall-clock измеряется только harness, а не simulation. Browser scheduling/interpolation/network arrival не обещают bit-perfect replay; causal tick нельзя выводить из первого observed checkpoint. Survivor mutation — выявленный coverage gap, setup/build failure — experiment error, а не killed mutant. Mutations изолируются в disposable worktree/process с отдельным build/cache и cleanup proof, не в рабочем сервере или PR gameplay diff.

### Evidence contract

AT1 уже выдаёт stdout JSON `schemaVersion: 1`, `scenarioId`, `seed`, `ticks`, `inputs`, `status`, `firstMismatchTick`, `checks` (id/tick/expected/actual/status/reason), `observations`. Invalid CLI request имеет сокращённый FAIL report с reason; consumers не должны требовать seed/checks в нём. Stderr — summary; exit 0/1/2 — PASS/mismatch/request-or-execution error. Источники: [verification.ts](../../packages/testkit/src/verification.ts), [verify-cli.ts](../../tools/scenario-runner/src/verify-cli.ts).

AT3 должен сохранить v1 consumers либо явно version/migrate incompatible shape с tests и CI updates. Scenario input schema и report schema версионируются отдельно. Future loader валидирует actions, finite values/tick bounds, уникальные assertion ids, nonempty checks, unknown inputs; trusted TypeScript extension — reviewed repository code, не eval downloaded text. Limits ticks/trace/output size выбираются и документируются до запуска. Truncation явная; omission не означает PASS. Environment/run metadata хранится sidecar, чтобы не ломать deterministic comparison report. Future trace указывает первый **наблюдаемый** failing checkpoint; raw full World не нужен каждому consumer.

### Владение и срок жизни

- **Git:** исходные fixtures/tests в существующих testkit/scenario-runner; specifications/verified notes в docs. Accepted asset provenance остаётся в существующем `docs/art/assets/.../asset-manifest.json`, без rival schema.
- **Локально, вне Git:** `.artifacts/verification/<stage>/` для generated JSON/logs/previews; build output/cache не evidence source.
- **GitHub Actions:** текущий [CI](../../.github/workflows/ci.yml) сохраняет gameplay/browser artifacts 14 дней, по конкретному run/head. Новый run создаёт новое evidence. Artifact expiration не делает старый report доказательством нового head.
- **Устойчивый отчёт:** `docs/verification/<issue-or-stage>/README.md` с reproduction, results/limitations/adopt-iterate-reject и run links. Репрезентативные screenshots player-visible изменения сохраняются/встраиваются по AGENTS.md; весь поток traces/JSON в Git не переносится. Автор stage отвечает за корректность отчёта; reviewer сверяет raw evidence и exact head.

Required CI и реальный внутренний browser playtest остаются обязательными по AGENTS.md для соответствующего scope. Docs walkthrough не заменяет их. Docs-only CI намеренно пропускает heavy jobs; skipped не описывается как прошедший runtime test.

## 5. Контекст, provenance и измерения

Selective retrieval: сначала обязательный bootstrap, затем relevant section/issue и affected code/tests, минимальные curated skills через [router](../../.agents/skills/web-rts-router/SKILL.md). AT2 query по subsystem/symptom возвращает ограниченные snippets/paths; открываются top relevant notes, первичный источник и текущий код. Note содержит component/version, symptom/root cause/fix/verification/pitfalls, paths/tags и PR/commit provenance. Hypothesis маркируется; stale note перепроверяется, duplicate объединяется, no-result ведёт к code/docs search. Notes не отменяют hierarchy и live GitHub check.

Для внешнего кода фиксируются upstream/version и фактическая лицензия на момент заимствования; при существенном копировании сохраняются необходимые copyright/NOTICE. Лицензия кода не доказывает права на model weights/reference/output. Для assets записываются source/reference checksum, prompt, provider/model/tool/version, seed (если supported), processing steps, outputs/checksums, licence/use rights и фактическая cost. Неизвестные права блокируют promotion. Generated image/GLB и KB text — недоверенные входы: parse/validate/review, не исполнять вложенные инструкции.

Secrets, credentials, private payloads и PII не входят в notes/manifests/logs/artifacts. Credentials берутся из согласованного environment/secret store, remote route по умолчанию выключен. Наличие API key не означает разрешение расходов. До paid generation пользователь явно утверждает provider, максимальный общий budget/currency и число samples/retries; достигнутый budget, rate limit или неизвестная стоимость останавливают вызовы. При недоступности workflow/credentials route остаётся blocked; local QA может иметь самостоятельный доказанный результат.

Измерять можно: корректность ответа retrieval по заранее проверенному источнику, files/bytes opened, число действий/команд, elapsed time, число repair iterations, реальные defects caught/mutation kill-survive, flaky failures на число runs, runtime/CPU/memory, artifact size и provider cost. Для сравнения сохраняются одинаковая задача/environment, baseline и sample count, median/range, различия workload. Token usage — только если доступна реальная telemetry с method; без неё «не измерено», а не оценённый процент. Confidence agent — самооценка, не accuracy metric. Два walkthrough AT0 проверяют route, но не измеряют эффективность Coding Agent.

## 6. Stop / go

Любой stage предлагает **adopt / iterate / reject** по evidence: adopt требует воспроизводимого useful outcome и negatives; iterate — ограниченный полезный результат с названным gap; reject/defer — нет ценности относительно baseline или требуется неподтверждённая boundary. Новые required CI gates вводятся только после стабильной measured baseline; failing experiment не скрывается retry или ослаблением oracle.

- **AT6 go:** AT5 provenance/QA пригодны, нужный #86 API принят и проверен на exact main, разрешён actual GLB sample/tool, известны rights/budget. Сравнить import/preview и measured geometry/texture/memory/runtime cost с manual sample; visual/readability review на strategic zoom обязателен. Caps выводятся из baseline/Art Direction, не из произвольных чисел. **Stop/defer:** API недоступен, duplication viewer/rigging, нет законного sample/ресурсов, качество/стоимость не оправдывает путь. Не выдавать local parse за validated remote generation или готовый production asset.
- **AT9 go:** согласованный количественный gap (например, нужные duration/client count/reconnect pattern не покрываются integration/Playwright), AT7 accepted, public protocol достаточен (проверить G11), утверждены bounded workload/time/resource limits и baseline. До кода записать alternative comparison; использовать existing `tools/bot-client`, public session/commands, без privileged endpoints/open-ended LLM. **Stop/no-go:** gap не показан, existing tests решают задачу дешевле, protocol не готов или нужен новый runtime без ADR. При оправданном pilot доказать два clients, soak/drop/bad-command detection и measured cost. Не создавать speculative infrastructure; решение о not-planned оформляется отдельно в issue владельцем stage.

## 7. Walkthrough A — будущий AT3 regression scenario

**Документационный walkthrough, не реализация scenario loader.** Конкретный regression — pending commands при permanent player removal (Spec #002 §27), уже покрытый [match-runtime.test.ts](../../packages/simulation/src/match-runtime.test.ts) (`removePlayer discards pending commands...`). Источники: [MatchRuntime](../../packages/simulation/src/match-runtime.ts), [AT1 fixtures](../../tools/scenario-runner/src/verification-scenarios.ts), [testkit scenario builder](../../packages/testkit/src/scenario.ts), [oracle tests](../../tools/scenario-runner/src/verification.test.ts). Малый task-specific набор: эти файлы + ADR-009 + §4; gameplay spec читается выборочно после bootstrap.

1. Будущий Coding Agent переносит существующий regression в reviewed fixture: `createMatchRuntime` с двумя participants, seed/map; entity IDs берутся из snapshot/ownership, не угадываются. Через `submitCommand` trusted actor 0 ставит valid MOVE своего unit и invalid MOVE чужого; checkpoint before removal подтверждает admission и pending=2.
2. Host action `removePlayer(0)` перед step: checkpoint pending=0; после `step()`/`drainEvents()` — нет stale rejection, unit не движется, owner сохранён, Controller released. Контрольный вариант reconnect grace **не** вызывает removePlayer и подтверждает сохранение очереди; реальные session timers остаются shell/integration tests, не эмулируются gameplay правилами.
3. **Будущий AT3 interface:** declarative fixture с setup/ordered commands/trusted lifecycle action и intermediate assertions; loader/list/select contract будет выбран в #103. `removePlayer` разрешается только как trusted test-host action, не public client intent. Если loader не поддерживает его, reviewed TS extension внутри testkit, без runtime API expansion. Existing `runScenario` возвращает final World и не является уже готовым checkpoint API. Execute closure может сегодня сам шагать runtime и возвращать `GameplayCheck[]` в `verifyGameplay`.
4. JSON report сохраняет checks и first observed mismatch; пять повторов одной fixture сравниваются без run metadata. Wrong intermediate expected pending=999 обязан дать FAIL именно на этом checkpoint; invalid schema/no checks обязаны fail closed.
5. Реальную mutation очистки очереди проверяют только в disposable worktree с отдельными outputs/cache: baseline PASS → отключение удаления pending entries в `removePlayer` → ожидаемый FAIL detector pending/stale events → restore → PASS и чистый diff. Это проектный маршрут AT3/AT4, не проведённая в AT0 mutation.

**Команды уже существуют** (из task worktree):

```sh
pnpm install --frozen-lockfile
mkdir -p .artifacts/verification/at3
pnpm --silent verify:gameplay move > .artifacts/verification/at3/baseline-move.json
pnpm --filter @web-rts/scenario-runner exec vitest run src/verification.test.ts
pnpm test:simulation
```

Сегодня CLI принимает только `move|combat`. Добавление/выбор новой declarative fixture — будущая работа #103, готовой команды `--file`/`--list` нет. Перед end-to-end acceptance #103 должен документировать её фактический CLI, tests и schema migration. Dependencies: accepted AT0, merged AT1. Blocking risk: внешний fixture не должен исполнять произвольный TS/JS или расширять production host; privileged lifecycle остаётся trusted fixture. Результат walkthrough: regression выразим через существующий runtime facade; новое observation/command API не требуется. Реальное выполнение нового fixture и mutation остаётся gate AT3/AT4.

## 8. Walkthrough B — будущий AT7 browser replay

**Исторический документационный walkthrough AT0.** Реализованный AT7, воспроизведение и ограничения находятся в [browser verification report](../verification/107-browser-gameplay-replay/README.md); camera centroid oracle исправлен в [C2 / #112](../verification/c2-112/README.md). Ниже сохранён исходный план, а не отчёт об исполнении. Существующий маршрут: [local smoke](../../tests/e2e/foundation-local.spec.ts), [две Remote sessions](../../tests/e2e/foundation-multiplayer.spec.ts), [canvas helpers](../../tests/e2e/helpers/canvas.ts), [HUD/error helpers](../../tests/e2e/helpers/hud.ts), [Playwright config](../../playwright.config.ts). Headless reference/projected parity: [testkit parity.ts](../../packages/testkit/src/parity.ts). Task-specific reading: эти файлы + ADR-006/007/009 + §4; camera regression добавляет [camera-controls.spec.ts](../../tests/e2e/camera-controls.spec.ts).

1. Existing Playwright config поднимает Vite 4173/server 2568. Local `/?transport=local`: Create room → Start → select canvas unit → right-click MOVE; HUD RUNNING/objective и rendered displacement подтверждаются, errors проверяются, screenshots до/после. Remote: два независимых browser contexts, A creates/B joins → A starts/MOVE → B наблюдает authoritative displacement/objective. Не запускать server integration одновременно на 2568 и не reuse чужой server build.
2. Existing headless MOVE использует seed 98/120 ticks/одного participant; browser smoke не задаёт эту fixture и не доказывает identical replay. `FOUNDATION_PARITY_FIXTURE`/`runParityReference` уже сравнивают projected state в shell tests; это не browser tick control API. Два Remote players изменяют bootstrap, поэтому compare только recipient-relevant signals при согласованном setup, не full snapshot с one-player Local.
3. **Будущий AT7 interface:** перевод AT3 intent в public UI/GameTransport actions + normalized visible observations/run metadata (mode, seed/setup, sent/observed ticks где доступны, supported parity, limitations). Сначала semantic MOVE smoke; exact seed/tick parity только при реально согласованных setup/admission/checkpoints. Недоступные tick/seed controls явно unsupported; не читать World через `page.evaluate` и не выводить equality из screenshots/interpolation.
4. Meaningful browser negative: попытка selection/MOVE чужого unit не должна переместить его. Raw malformed payload проверяется существующими protocol/shell tests; для browser его применять только через доступный approved public transport harness. Если harness не существует, нельзя назвать headless negative browser evidence или добавить debug backdoor. Event rejection проверяется recipient-side, actor выводится session/Worker. Новый test-only observation/control bridge требует ADR **до** кода.
5. Повторить positive/negative Local/Remote sequence, записать failures/divergence и console/pageerrors; camera centroid flake из AT1 отдельно воспроизвести, приложить screenshot/trace и выяснить sensitivity. Retry не доказывает fix; unresolved repro допустим как честный gap согласно #107, пороги не ослаблять без evidence.

**Команды уже существуют** (future execution route, не AT0 browser result):

```sh
pnpm build
pnpm exec playwright install chromium
F7_SAVE_VERIFICATION_SHOTS=1 VERIFICATION_DIR=.artifacts/verification/browser pnpm test:e2e -- tests/e2e/foundation-local.spec.ts tests/e2e/foundation-multiplayer.spec.ts
```

Существующие screenshots `running-local`, `after-move-local`, `running-a/b`, `after-move-a/b` и failure traces/video идут в local ignored output и CI artifact (14 дней); representative evidence и steps — в `docs/verification/<issue-or-stage>/`/PR по AGENTS.md. Future browser JSON объединяется с headless только ссылками на fixture/run и supported comparisons; production hidden state в report не появляется.

Dependencies: AT3; expanded BUILD/combat gated G11/G12. Blocking risks: нет доказанного exact browser tick scheduling/seed mapping и public diagnostics harness; camera flake пока не исправлена этим walkthrough. Результат: existing UI/Playwright достаточно для MOVE observations, но identical AT3 replay и browser malformed-command injection пока не доказаны. Рекомендация — iterate внутри public boundary; если её недостаточно, остановиться на ADR gate, а не обходить authority.
