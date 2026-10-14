# AT4 / #104 — Targeted Mutation Verification

[Issue #104](https://github.com/Web-Usov/web-rts/issues/104) · [Spec #003 §2–6](../../specs/003-agent-tooling-and-verification.md) · [Spec #002 §27](../../specs/002-first-economy-defense-vertical-slice.md#27-automated-testing-direction).

Эксперимент 14 октября 2026, macOS, Node 25.9.0 / pnpm 10.8.1. Base `origin/main`: `1fb21f0` (merged AT3 / PR #114); commit измеренной матрицы: `f8be1733b9040284837069781de2aa770937f5da`. Последующие изменения добавляют JSON preflight error, запрет неподдерживаемой платформы и этот отчёт; catalog/gameplay/detectors не меняются. Production simulation, protocol, transport, gameplay API и CI workflow не изменены.

## Воспроизведение

Работать из чистого task worktree с зафиксированным tooling commit:

```sh
pnpm install --frozen-lockfile
pnpm --silent verify:mutation --list
pnpm --silent verify:mutation combat-damage
pnpm --silent verify:mutation leave-queue
pnpm --silent verify:mutation targetability
pnpm --silent verify:mutation all --repeats=2 --strict
# Последняя команда должна вернуть 1: известный survivor не проходит detection gate.
AT4_INTEGRATION=1 pnpm --filter @web-rts/scenario-runner exec vitest run src/mutation.integration.test.ts
pnpm --filter @web-rts/scenario-runner exec vitest run src/mutation.test.ts
pnpm --silent verify:gameplay move
pnpm --silent verify:gameplay combat
pnpm --silent verify:gameplay permanent-leave
```

`--list` выдаёт reviewed catalog с source anchors, replacements, invariant, expected detector IDs/status и reproduction command. CLI принимает только известные IDs, `all`, `--strict` и `--repeats=1..3`; нет внешнего mutation JSON/eval. Реализация находится в [mutation-runner.ts](../../../tools/scenario-runner/src/mutation-runner.ts), каталог — [mutation-catalog.ts](../../../tools/scenario-runner/src/mutation-catalog.ts).

Exit 0 означает совпадение диагностического эксперимента с заранее заданной матрицей и успешный cleanup; он **не означает полное обнаружение mutations**. Даже ожидаемый survivor оставляет `detectionGatePassed:false`. С `--strict` exit 0 допустим только для полностью выполненной матрицы из ожидаемых `KILLED`; survivor/setup error/cleanup failure возвращают 1. Ошибка request/preflight возвращает 2 и JSON `status:SETUP_ERROR`. `diagnosticMatched` и `detectionGatePassed` раздельны. Opt-in integration tests в обычном test suite пропускаются; быстрые classification tests выполняются обычным CI. Mutation matrix не подключена к `ci-gate`; нового Actions workflow нет.

## Изоляция и evidence

Каждый эксперимент создаёт уникальный detached disposable worktree из конкретного commit, проверяет clean baseline, устанавливает только dependency closure scenario-runner и выполняет baseline. Ни task worktree, ни основной checkout, ни работающий server/browser не мутируются. Путь исходника ограничен `packages/simulation/src/`, parent symlinks отклоняются; anchor должен встретиться ровно один раз и replacement обязан изменить source. После записи проверяются содержимое, единственный изменённый файл и отсутствие новых untracked files.

Все `dist` шести связанных packages удаляются перед каждым baseline/mutant/restored build. Сборка выполняется напрямую `pnpm --filter @web-rts/scenario-runner... -r run build`, без Turbo. Compiled JS проверяется на replacement с учётом удаления TypeScript non-null assertion; его SHA-256 сохраняется. Detectors запускаются отдельным Node process из disposable checkout. У matrix собственный временный dependency store, у экспериментов отдельные worktree/node_modules/dist/TMPDIR/cache/output. Store повторно используется только внутри одной матрицы и затем удаляется. Общий compiled output/Turbo cache не используются.

После нормального эксперимента source восстанавливается, все зависимости пересобираются, повторный detector baseline должен побайтово совпасть. `finally` удаляет только зарегистрированный собственный worktree и принадлежащие запуску уникальные temp directories после проверки owner token/realpath. SIGINT/SIGTERM обрабатываются CLI через AbortSignal; owned child process group завершается, далее выполняется cleanup. Install timeout — 300 секунд, остальные commands — 180 секунд; stdout/stderr ограничены 2 млн символов каждый. Timeout, compilation/install failure, невалидный report или failure вне назначенных detectors — `SETUP_ERROR`, никогда kill. Поддерживаются macOS/Linux с POSIX process groups.

Reports `schemaVersion:1` лежат вне Git в `.artifacts/verification/at4/<UUID>/`: отдельный JSON каждого mutation/repeat и `matrix.json`. Это отдельная AT4 schema, AT1/AT3 report schema неизменна. В evidence сохраняются commit/environment, worktree/temp paths, source/diff/compiled fingerprints, command argv, stdout/stderr, exit/signal, wall-clock, baseline/mutant/restored reports, failing expected/actual checks, firstMismatchTick, execution witness и cleanup proof. Отчёты содержат offline fixture observations, без новой production/client boundary. Generated JSON/logs не коммитятся.

## Гипотезы и фактическая матрица

Ожидания и detector IDs закреплены в каталоге **до** практического прогона; ожидания после результатов не менялись.

| ID / invariant | Source anchor → replacement | Назначенные AT3 detectors | Ожидание и результат двух повторов |
| --- | --- | --- | --- |
| `combat-damage`: strike уменьшает Health | `systems/combat.ts`: `world.health.get(targetId)!.current -= profile.damage;` → `world.health.get(targetId)!.current -= 0;` | `combat`: `enemy-killed`, `soldier-idle-after-combat` | `KILLED`, 2/2, exit 1, firstMismatchTick 130 |
| `leave-queue`: permanent leave удаляет pending commands без stale events | `match-runtime.ts`: `this.queues.delete(playerId);` → `this.queues.has(playerId);` | `permanent-leave`: `pending-after-removal`, `no-stale-events` | `KILLED`, 2/2, exit 1, firstMismatchTick 0 |
| `targetability`: allowedTargets ограничивает kinds | `systems/combat.ts`: `profile.allowedTargets.includes(identity.kind) &&` → `identity.kind !== undefined &&` | `combat`: `enemy-killed`, `soldier-survived`, `soldier-idle-after-combat` | `SURVIVED`, 2/2, 8/8 PASS, exit 0, firstMismatchTick null |

Пути source anchors выше относительно `packages/simulation/src/`. Каждый detector command: `node tools/scenario-runner/dist/cli.js <scenario>` в disposable checkout; commands/evidence точные в raw report.

M1: enemy остаётся живым вместо `null`, Soldier остаётся `ENGAGING` вместо `IDLE`. M2: `pending-after-removal` actual 2 вместо 0; на tick 1 возникают stale rejection events, removed actor ошибочно остаётся participant. Также расходятся grace-pending и final no-events checks. FirstMismatchTick — первый **наблюдаемый checkpoint**, не доказанный causal tick.

M3 — настоящий пробел **выбранного AT3 Combat oracle**: его hostile UNIT допустим для Soldier, другие запрещённые kinds/profile restrictions fixture не упражняет. Отдельный trusted execution witness создаёт hostile живую UNIT, устанавливает `allowedTargets:[]` и вызывает production `isValidCombatTarget`: baseline `forbiddenTargetAccepted:false`, mutant `true` в обоих повторах. Witness не входит в kill detector и не превращает survivor в kill. Непустой source diff, fresh compiled fingerprint и противоположные ответы production predicate доказывают исполняемую mutation. Это не утверждение о gap всего test suite: `packages/simulation/src/combat.test.ts` отдельно проверяет запрещённый RESOURCE с Health/Team. Для расширения узкого oracle нужен отдельный отрицательный targetability fixture/check.

SHA-256 detector stdout одинаков в независимых повторах:

- M1: `19ae2b929580606b22efc8a0c000c21043c15f73fc6050c497d5749ba0a18e47`.
- M2: `92cc172fdb077eea4fbaca40c81b95c8d452a78dd6ae3fde7857b9b3ac926b1a`.
- M3: `94dc3f9c0ea3a2893958dde043a1692bb3e57cfdace3e31bbb7149651fd7540e` (тот же PASS report, что baseline AT3).

Полная строгая matrix: `complete:true`, `diagnosticMatched:true`, `detectionGatePassed:false`, exit **1**. Все 6 expected statuses совпали; survivor честно блокирует detection gate.

## Негативные проверки и cleanup proof

Реальные opt-in integration tests на commit измеренной матрицы: **4/4 PASS**, 189,94 секунды:

1. Отсутствующий `NOT_A_REAL_ANCHOR`: baseline PASS, `SETUP_ERROR`, anchor не найден, gate false.
2. Неоднозначный `world.health`: baseline PASS, `SETUP_ERROR`, anchor встречается несколько раз, gate false.
3. Injected exception после применённого damage diff: sourceBefore/sourceAfter различны и diff сохранён, `SETUP_ERROR`, worktree удалён.
4. AbortSignal прерывает owned command: `SETUP_ERROR`, worktree/temp удалены, gate false.

Test seam `fault:after-mutation` доступен только внутреннему TypeScript integration test, не CLI/JSON. Реальные CLI unknown ID и dirty-source preflight вернули exit 2 / JSON `SETUP_ERROR`, не создавая experiment. Safety tests также подтверждают отказ при untracked/staged changes и fingerprint содержимого untracked files. Быстрые unit tests дополнительно проверяют non-changing replacement, failing baseline, empty/missing/unrelated detectors, противоречивый PASS, compilation/request exit 2, null/timeout exit, unexpected survivor и cleanup failure; ни один из них не проходит gate.

Исходные три AT3 baselines прошли: MOVE 7/7, Combat 8/8, permanent-leave 15/15. Каждый из шести restored baselines совпал с соответствующим pre-mutation report побайтово. Cleanup **6/6**: disposable worktree отсутствует в Git registry и на диске, temp отсутствует, tracked/untracked source fingerprint исходной ветки совпадает. Matrix store также удалён. Fingerprint вычисляет `git diff --binary HEAD` и contents untracked non-ignored files: оба matrix fingerprints `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` означают отсутствие tracked/untracked изменений. Основной shared checkout сохранил исходный HEAD и clean status. Финальный task baseline после всех cleanup снова проходит все три scenarios.

Неудачные предварительные запуски сохранены отдельно: холодный install всего monorepo превысил исходный 180s limit; остановки SIGTERM/owned process SIGKILL дали `SETUP_ERROR` с успешным cleanup. Первая проверка compiled TS replacement ошибочно требовала сохранять `!` в JS и остановила эксперимент как `SETUP_ERROR` **до detector**. После исправления emitted-code check и scoped install проведена новая полная матрица, без изменения gameplay hypotheses. Первые infrastructure integration attempts не дошли до anchor assertions и были FAIL; исправленные прогоны 4/4 PASS. Эти failures не входят в 4 kills.

SIGKILL самого runner, power loss и filesystem отказ не допускают гарантированного исполнения `finally`: это ограничение процесса. При таком сбое нельзя считать gate успешным; inspect recorded paths/owner/worktree registry и удалить только принадлежащие эксперименту ресурсы. Автоматический поиск/удаление чужих stale worktrees не реализован.

## Runtime/cost и сравнение

Wall-clock измерен `performance.now()` **в Node tooling**, за пределами simulation. Concurrent negative integration suite в первой части прогона создаёт нагрузку; это не изолированный CPU benchmark. Отдельное simulation CPU time, token usage и стоимость работы Coding Agent **не измерены**. Detector timing ниже включает startup + simulation + JSON; install/build не смешиваются с ним.

| Mutation | Полный experiment, s (два повтора) | Install, s | Сумма трёх fresh builds, s | Mutant detector process, s |
| --- | --- | --- | --- | --- |
| combat-damage | 82,94 / 43,75 | 35,95 / 5,77 | 42,12 / 33,41 | 0,598 / 0,454 |
| leave-queue | 72,45 / 43,76 | 6,32 / 6,14 | 60,05 / 32,96 | 0,873 / 0,527 |
| targetability | 55,73 / 44,10 | 7,17 / 6,31 | 42,34 / 33,00 | 0,563 / 0,432 |

Полная matrix из 6 экспериментов, включая worktree creation, install, 18 fresh builds, baseline/mutant/restored subprocesses, два witness pairs и cleanup: **343,86 s (5,73 min)**. Подготовка/сборка доминирует; у второй тройки тёплый matrix-local dependency store. Все worktree/output независимы, compiled JS и detector reports каждой mutation совпали в двух повторах. Два повтора подтверждают этот bounded pilot, но не доказывают cross-platform/flakiness стабильность.

[AT1](../98-gameplay-harness/README.md) вручную отключал damage и обнаружил final Combat mismatch; автоматизированная AT4 проверяет такой же дефект и добавляет explicit unique anchors, emitted-code verification, statuses, exception/interruption cleanup и воспроизводимую матрицу. Время ручной AT1 подготовки/rollback не опубликовано, количественное ускорение agent workflow не заявляется. [AT3](../103-gameplay-verification-v2/README.md) измерял тёплые CLI processes около 0,49–0,52 s median; текущие detector timings сопоставимы, но workload mutations/конкурентная нагрузка отличаются. AT4 существенно дороже обычного AT3, поскольку проверяет качество oracle через три rebuilds и изоляцию на experiment. AT3 checkpoints особенно полезны для M2: pending=2 вместо 0 сразу на tick 0, а не только final outcome.

## Решение и регулярный CI

**Iterate.** Adopt как opt-in диагностический инструмент: два реальных defect detectors повторяемы, survivor демонстрирует узость oracle, setup failures не дают false-green, cleanup подтверждён. Для required gate выборки и стоимости недостаточно.

Кандидат будущего focused manual/nightly CI — `combat-damage` + `leave-queue` со строгой оценкой, затем отдельное решение о required gate после повторов на Node 22/Linux, измерения CI cold install/build и отсутствия flakes. `targetability` оставить ручным диагностическим survivor до добавления отрицательного AT3 fixture, затем заново закрепить expected `KILLED` в отдельной задаче. Полную матрицу, fault/abort experiments и cold dependency-store pilot пока не делать required: их стоимость заметно выше обычного headless gate. Existing ordinary CI, browser E2E и independent review остаются обязательными; новый mutation workflow не добавлен.

Локальные `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:simulation`, `pnpm build` прошли; scenario-runner — 41 PASS + 4 opt-in skipped, отдельно реальные integration 4/4 PASS. GitHub Actions на exact PR head проверяются отдельно и фиксируются в PR. Tooling-only diff не меняет player-visible flow, поэтому screenshots не требуются. Architectural impact: **none**; Node/process/filesystem APIs только в offline scenario-runner, не simulation.

Project Status Check: **Required — выполнен**: checkpoint с CLI, отчётом, известным survivor и opt-in policy обновлён без transient main SHA/PR/CI state. AT5/AT7/AT8 и gameplay features не реализованы.
