# AT3 / #103 — Gameplay Verification v2

[Issue #103](https://github.com/Web-Usov/web-rts/issues/103), [Spec #003](../../specs/003-agent-tooling-and-verification.md). Эксперимент 14 октября 2026; base `bda1373`, Node 25.9.0 / pnpm 10.8.1, CI Node 22. AT1 #98 / PR #99 и AT0 #101 завершены. Проверена только KB note `permanent-leave-queue` и её первичные источники: MatchRuntime/removePlayer, runtime regression tests, FoundationRoom/onDrop/onLeave, ADR-009; #54 / merged PR #73. Gameplay/production API не изменены.

## Воспроизведение

Из task worktree:

```sh
pnpm install --frozen-lockfile
pnpm --silent verify:gameplay --list
pnpm --silent verify:gameplay move
pnpm --silent verify:gameplay combat
pnpm --silent verify:gameplay permanent-leave
pnpm --silent verify:gameplay --json "$(cat tools/scenario-runner/scenarios/move.json)"
pnpm --filter @web-rts/scenario-runner exec vitest run src/verification.test.ts src/scenario-definition.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm test:simulation
pnpm build
```

Повторы в независимых процессах и побайтовое сравнение:

```sh
mkdir -p .artifacts/verification/at3
for id in move combat permanent-leave; do
  for n in 1 2 3 4 5; do
    pnpm --silent verify:gameplay "$id" > ".artifacts/verification/at3/$id-$n.json" 2> ".artifacts/verification/at3/$id-$n.log"
    cmp ".artifacts/verification/at3/$id-1.json" ".artifacts/verification/at3/$id-$n.json" || exit 1
  done
done
```

## Контракт сценариев и CLI

Checked-in JSON находятся в `tools/scenario-runner/scenarios/`. Чтобы добавить fixture: скопировать подходящий JSON, изменить id/setup/operations/checks, добавить id в `SCENARIO_IDS`, выполнить CLI и добавить behavioral test. Данные читаются из фиксированного registry; id никогда не является путём. `--json` принимает текст JSON, не путь. `--list` возвращает `{schemaVersion:1,scenarios:[...]}`. Старые `move`, `combat`, `gameplayScenario()` и `verifyGameplay()` работают; exit **0** PASS, **1** assertion mismatch, **2** invalid request/execution error. Stdout содержит только JSON, stderr — summary.

Input version **1** независим от report `schemaVersion:1`. Report сохраняет AT1 envelope: scenarioId/seed/ticks/inputs/status/firstMismatchTick/checks/observations; checks — id/tick/expected/actual/status/reason. `inputs` теперь содержит definition, `observations` — bounded trace/events вместо полного final snapshot: эти scenario-specific opaque поля не имеют прежней побайтовой формы. `enemy-killed` теперь сравнивает entity projection с `null` вместо boolean. Consumers envelope и старый CI negative gate сохранены; legacy execute closures также работают. Error report остаётся сокращённым FAIL/reason, как в AT1.

В JSON все поля обязательны, неизвестные ключи отвергаются:

- Root: `version:1`, `id`, uint32 `seed`, `ticks`, `setup`, `selectors`, `operations`.
- `setup`: `fixture:"match"|"combat"`, `players` — уникальные player IDs 0–3 (1–4 participants; Combat только `[0]`). Match использует production foundation map/default RuntimeConfig; Combat — reviewed World builder с прежними soldier/enemy/map. Новый fixture требует review TypeScript registry, JSON не импортирует код.
- `selectors`: alias → `{definitionId,ownerPlayerId,index}`. IDs связываются один раз по **initial snapshot**, matching entities в ascending entityId order; index выбирает 0-based match. Alias остаётся связанным после removal/death, чтобы отсутствие entity не переназначило selector. Неразрешённый selector — execution error.
- Ordered `operations`: `{tick,type:"move",playerId,commandId,entity,target:{x,y}}`; trusted host lifecycle `{tick,type:"removePlayer",playerId}`; checkpoint `{tick,type:"check",id,query,expected,initial}`. MOVE проходит production submitCommand/semantic validation. removePlayer — только offline trusted host operation, без public-client API. Combat MOVE использует существующий World enqueue; его admission означает enqueue fixture, без MatchRuntime ingress caps.
- `query`: entity `{type:"entity",entity,fields}`; metric `{type:"metric",field}`; admission `{type:"admission",commandId}`; events `{type:"events",filter}`. Entity отсутствует → `null`; отсутствующее optional field → `null`. Entity fields: entityId/kind/definitionId/x/y/ownerPlayerId/controllerPlayerId/soldierState/health/teamId. Metrics: tick/entityCount/pendingCommandCount/processedCommands/reservedCommandPathCost/commandBudgetUsed/commandBudgetRemaining/activeTaskQueries/aiQueries. Combat поддерживает первые три metrics; недоступная metric — error. Event filter допускает type/commandId/reason/recipientPlayerId/tick, exact equality, empty filter выбирает все события; expected array сравнивается целиком, включая порядок. `[]` доказывает absence; непустой expected — presence с точными данными. Admission query ссылается только на предыдущий MOVE. `initial:true` допустим только для entity query с `expected:null`: expected берётся из initial projection (например, неизменность позиции).

**Tick semantics:** наблюдаемый tick N — после N steps. Operations на N идут строго в JSON order **до** step N→N+1. На последнем tick steps нет. Поэтому pending=2 → removePlayer → pending=0 на tick 0 наблюдают разные промежуточные состояния. Check на tick 1 видит результат первого step. Events drain выполняется после **каждого** step; queries читают накопленные события до своего checkpoint. Event `tick` сохраняет production timestamp, trace `observedTick` показывает tick после drain. Это разные понятия. `firstMismatchTick` — минимальный tick failing checkpoint, не доказанный causal tick.

Caps: input/каждый CLI argument 64 KiB UTF-8, nesting 32, ticks ≤1000, operations ≤256 (следовательно commands/lifecycle также bounded), checks 1–128, selectors 1–16/index ≤15, fields 1–16 без duplicates, events ≤512, итоговый JSON ≤256 KiB. Player IDs 0–3, identifiers ≤64 безопасных символов, координаты finite и |value|≤10000. Duplicate assertion/command IDs, unordered/out-of-range ticks, unknown actions/fixtures/fields, empty checks, non-finite values и traversal отвергаются. Caps вызывают **ошибку**, truncation отсутствует. Trace содержит actions/admissions, checkpoint projections и event batches, без per-tick World dump/wall-clock. Production semantic rejection остаётся наблюдаемым результатом, admission не означает разрешение gameplay.

## Реальные результаты и негативные доказательства

| Mode / fixture | Checks | PASS repeats | Median ms | Range ms | JSON bytes |
| --- | ---: | --- | ---: | --- | ---: |
| AT1 / move | 4 | 5/5, byte-identical | 639.0 | 479.8–671.7 | 9568 |
| AT1 / combat | 4 | 5/5, byte-identical | 510.6 | 485.9–560.0 | 5070 |
| AT3 / move | 7 | 5/5, byte-identical | 523.1 | 495.2–611.3 | 5172 |
| AT3 / combat | 8 | 5/5, byte-identical | 490.6 | 463.2–580.3 | 8391 |
| AT3 / permanent-leave | 15 | 5/5, byte-identical | 495.0 | 469.9–605.3 | 12247 |

Измерения: 5 независимых Node processes каждого fixture, `performance.now()` вокруг spawnSync; warm compiled JS, startup + simulation + JSON. AT1 source взят из base `bda1373` и transpiled в локальный ignored dist; та же production simulation и совместимый verifyGameplay. MOVE seed98/120 ticks и Combat seed59/130 ticks имеют те же setup/ordered gameplay commands. AT3 выполняет больше checkpoints и per-step event drain; AT1 запускается через `node --input-type=module -e`, AT3 через CLI file и JSON loader. Permanent leave — новый workload, baseline для него нет. Диапазоны перекрываются; ускорение simulation не доказано. Wall-clock находится только в `measurements.json`, comparison reports его не содержат.

SHA-256 AT3 reports:

- move: `53d942d10a3322280053e4dc9cc3e2be2596bc8d102e29d43c36f5c646574451`.
- combat: `94dc3f9c0ea3a2893958dde043a1692bb3e57cfdace3e31bbb7149651fd7540e`.
- permanent-leave: `03edf13a596047907b6251b203a8029fe9c3786e18b75816ad26a6076c037ad2`.

AT1 SHA совпали с опубликованным #98 report: MOVE `2e275507c95fa289e50b1949c554e1efcb4250f90b8f883def50a87ebd4cd6e7`, Combat `783c55c5762cec27a26a369e6052c3075c8dfd8583badeecf848f7a6717b56ad`.


MOVE: реальный admission, очередь до/после step, ownership/control, точное прибытие (4,-3) на 120, absence rejection. Combat: initial/intermediate health, applied MOVE event на наблюдаемом tick 2 (event tick 1), enemy death, Soldier survival/IDLE, no rejection на 130. Permanent leave: valid own/invalid foreign commands admitted, pending=2/0 до/после removal, после step position/Owner/entity сохранены, Controller=null, stale events отсутствуют; removed actor получает not_participant. Отдельный контроль grace для participant 1 без removePlayer: очередь сохраняется до step, MOVE достигает цели, Owner/Controller остаются. Runtime test также отдельно доказывает реальный foreign-unit rejection, сохранённый до checkpoint 3. Session timers/reconnect handshake не эмулируются: их покрывают existing server integration tests.

Негативы (реальные независимые CLI runs): expected pending=999 на `pending-before-removal` → exit 1, FAIL, actual=2, firstMismatchTick=0. Ожидание отсутствующего COMMAND_APPLIED/missing в Combat → exit 1, FAIL на 130. Дополнительно controlled corruption observed enemy projection → FAIL `enemy-killed`; это sensitivity oracle, **не** production mutation. Production mutation не выполнялась; AT4 framework не добавлен. Invalid requests/schema/caps проверены tests; executable unknown/no-args checks возвращают 2. Ранний checkpoint сообщает конкретную очередь и соседние actions; AT1 при неверной финальной MOVE-позиции сообщал только final tick 120. Отдельный legacy wrong-final gate продолжает находить FAIL на 120.

Локальные `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:simulation`, `pnpm build` завершились успешно. Scenario-runner: **33 tests PASS** (5 files); legacy verification tests сохранены. Standalone CLI unknown/no-args/invalid JSON/traversal реально вернули exit 2; legacy wrong-final oracle — FAIL/tick120. Полные логи находятся в локальной artifacts directory. GitHub Actions проверяются отдельно на PR head, их актуальный результат указан в PR.

## Ограничения и решение

Нет arbitrary JS/eval/dynamic module import, нового package/runtime, client/World bridge, bots или browser replay. Поддерживаются только MOVE и removePlayer; другой command/setup добавляется reviewed кодом. Trace и итоговые checks проходят caps, большие запросы требуют уменьшения workload. Сравнение JSON гарантируется для одного runtime/code/config, не bit-perfect cross-platform. Hidden state находится только в offline test fixture. Tooling-only изменение не меняет player-visible flow; ручные screenshots не требуются. Полный existing browser E2E/ci-gate остаётся обязательным на exact PR head.

**Adopt** для bounded headless regressions: новый regression описывается JSON и использует production runtime, ранние checkpoints и transient events дают полезную диагностику. Дальнейшие команды, browser parity и mutation matrix — отдельные AT stages. Token savings и causal localization не измерены и не заявляются.

Project Status Check: **Not required** — AT track уже принят, roadmap и project-wide invariants не изменены. Spec §7 сохраняет исторический AT0 walkthrough; фактический AT3 контракт описан здесь и в tests. Полные reports/trace/логи/timing sidecar сохранены локально в `.artifacts/verification/at3/`, generated evidence не коммитится. CI добавляет permanent-leave report в существующий gameplay-verification-evidence artifact (14 дней), без отдельного дублирующего gate.
