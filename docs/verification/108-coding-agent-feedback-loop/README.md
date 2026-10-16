# AT8 / #108 — Coding Agent feedback loop (pilot)

[Issue #108](https://github.com/Web-Usov/web-rts/issues/108) · [Spec #003](../../specs/003-agent-tooling-and-verification.md) · Эксперимент 16 октября 2026, base `61ea130ee390b7474580baa80fcb52514a718a70` (AT2/AT3/AT4/AT7 смержены: #111, #114, #115, #116). Node 22.22.3, pnpm 10.8.1, модель агентов `claude-sonnet-5-5`.

**Итог: Iterate.** Route остаётся опциональным; на n=1 он не снизил стоимость, но дал более сильное evidence. Production gameplay в PR не изменён.

## Что добавлено

- [`.agents/skills/web-rts-feedback-loop/SKILL.md`](../../../.agents/skills/web-rts-feedback-loop/SKILL.md) — 9-шаговый цикл (context → hypothesis/oracle → FAIL → diagnose → fix → retest → handoff), ~3,7 КБ, читается **только по запросу**.
- Одна строка в router `web-rts-router` и короткий раздел в `docs/agentic-workflow.md`.
- [`scripts/agent-loop-summary.mjs`](../../../scripts/agent-loop-summary.mjs) (`validate` / `render`) + тесты (в `pnpm test:kb`).

Не добавлено: orchestrator, LLM API, БД, новый runtime. Merge, review, ADR и CI не затронуты.

### Bootstrap-контекст

Обязательный для Coding Agent bootstrap: `AGENTS.md` (24 355 Б, без изменений) + router (2 529 → 2 726 Б, **+197 Б**). `docs/agentic-workflow.md` (+639 Б) читает Task Chat. Skill (3 708 Б), `scripts/agent-loop-summary.mjs`, этот отчёт и `docs/knowledge` читаются по запросу.

## Воспроизведение

```sh
pnpm kb search "pending MOVE" --component runtime --limit 3
pnpm verify:gameplay --list
pnpm verify:gameplay permanent-leave          # exit 1 на дефекте
pnpm verify:mutation leave-queue              # только на clean committed tree
AT7_EVIDENCE_DIR=.artifacts/verification/at8/at7 pnpm verify:browser --retries=0
node scripts/agent-loop-summary.mjs validate|render <summary.json>
```

## Дефект и условия эксперимента

Дефект = зарегистрированная мутация AT4 `leave-queue`: `packages/simulation/src/match-runtime.ts`, `removePlayer`: `this.queues.delete(playerId);` → `this.queues.has(playerId);`. Нарушенный invariant (ADR-009): permanent leave атомарно удаляет pending commands игрока и не создаёт stale recipient events. Fingerprint `match-runtime.ts` SHA-256: оригинал/исправленный `be5356f1…180f71`, дефектный `e9664ea2e4289151…95721c`.

Окружения: `git archive` от `61ea130` → мутация → новый одно-commit git repo (без history, чтобы `git log/diff` не показывали дефект) → `pnpm install --frozen-lockfile`. Ожидаемый детектор: `permanent-leave` (до fix: FAIL, `firstMismatchTick` 0, 5 failing checks: `pending-after-removal`, `no-stale-events`, `removed-player-rejected`, `grace-pending-retained`, `no-events`). Успех: этот сценарий 15/15 PASS, `move`/`combat` PASS, нет правок тестов/fixtures. Одинаковая task description (симптом без указания файла и детектора); Baseline — без skill-файлов; Treatment — тот же snapshot + route-файлы + требование выполнить `kb search` и сверить note с кодом и ADR-009. Два независимых субагента Claude Code (отдельные контексты, без доступа друг к другу), запущены параллельно.

## Результаты A/B

| Метрика | Baseline | Treatment |
| --- | --- | --- |
| Токены (harness `subagent_tokens`, только total) | 62 764 | 78 314 |
| Tool uses (harness) | 8 | 18 |
| Elapsed (harness) | 52,4 с | 394,0 с |
| Прочитанный контекст (self-report) | AGENTS.md **не прочитан** (только `wc`), `match-runtime.ts` частично через grep | AGENTS.md, router, skill, KB note, `match-runtime.ts` ≈ 45 КБ; ADR-009 — grep |
| Первый meaningful failure | `vitest run` (unit, команда 2) | `verify:gameplay permanent-leave` (команда 7) |
| Нарушенный checkpoint | unit-тесты `match-runtime.test.ts:280`, `scheduling.test.ts:84` | 5 checkpoints AT3, `firstMismatchTick` 0 |
| Root cause hypothesis | `removePlayer`: no-op `queues.has` вместо delete | то же + stale `COMMAND_REJECTED`, `submitCommand` продолжает принимать |
| Repair iterations / ложные диагнозы | 1 / 0 | 1 / 0 |
| Patch | 1 строка, SHA-256 `42f24f22…cba2c` | идентичный (`cmp` совпал) |
| Ретест по агенту | simulation vitest 245/245, tsc | AT3 permanent-leave/move/combat PASS, vitest 245/245 |
| Артефакты | diff, pre/post JSON | + `summary.json` (validate OK) |

Независимая проверка оркестратором после обоих fix: `permanent-leave` exit 0 (15/15), `move`, `combat` exit 0, оба diff идентичны. Handoff Treatment валидируется и рендерится (`render`).

### Телеметрия и caveats

- Токены — только `subagent_tokens` из usage-уведомления harness: total без input/output/cache. Токены не оценивались по символам. Время — wall-clock harness, включает ожидание и работу при параллельной загрузке CPU (confounder). Время до root-cause hypothesis отдельно не измерено (self-report без timestamps).
- **n=1 на ветку; статистического вывода нет.** Одна модель, но разные пути: Baseline нарушил инструкцию (не читал AGENTS.md и prescribed docs, не запускал AT3), поэтому он дешевле. Это одновременно confounder и наблюдение: при «ленивом» следовании существующему workflow дефект с хорошими unit-тестами находится дёшево.
- Treatment столкнулся с дефектом окружения: в одно-commit snapshot `pnpm kb search/show` падает (`commit provenance unavailable`, KB требует git history). Агент прочитал note напрямую и сверил с ADR-009 line 48. В реальном worktree тот же `kb search "pending MOVE" --component runtime --limit 3` корректно возвращает `permanent-leave-queue`. `pnpm test:server` падал `EADDRINUSE :2568` (порт занят dev server другой сессии): окружение, не регрессия; игнорировано в обоих fix.
- Агентский `summary.json` содержал `elapsedSeconds 0`, `not_measured`, `cleanup false`; значения исправил оркестратор (отмечено в `limitations`). Baseline summary составлен оркестратором из отчёта агента (self-reported).
- Оба агента на одинаковом тривиальном дефекте (1 строка, no-op expression); результат не обобщается на сложные дефекты.

## Интеграция с AT3 / AT4 / AT7 (на исправленной версии)

Production source ветки идентичен `61ea130` (fixed). Проверено на commit `884865e…`:

- **AT3**: `permanent-leave` 15/15, `move` 7/7, `combat` 8/8 (exit 0). Failing: см. `expA/expB-permanent-leave-pre.json`.
- **AT4**: `verify:mutation leave-queue` → `KILLED`, ожидание совпало, 40,4 с, cleanup `passed:true`. Первая попытка на dirty tree корректно отказала (`baseline source must be clean`, exit 2/JSON SETUP_ERROR) — запускать после commit. Полная matrix не запускалась.
- **AT7** regression smoke: `verify:browser --retries=0` — 7/7 (MOVE local 12,8 с, MOVE remote 1,4 мин; общий 100 с). Это **не** oracle очереди permanent leave: он лишь показывает отсутствие регрессий MOVE.
- C1 camera flaky: не запускалась, не затрагивалась.

## Cleanup proof

Disposable `expA`/`expB` (одно-commit repos вне Git репозитория) удалены; task worktree clean, `git diff 61ea130 -- packages` пуст. Reviewable evidence в Git: [`evidence/`](evidence/) — два summaries, identical diff (`expA.diff`/`expB.diff`), slimmed pre/post AT3 checks, fingerprints, происхождение telemetry (`ab-evidence.json`; harness records vs self-reported). Raw в ignored `.artifacts/verification/at8/` (diffs, pre/post JSON, AT4 JSON, AT7 log, summaries); AT4 удалил свой worktree/temp сам (`worktreeRemoved`, `directoryRemoved`, `sourceUnchanged`).

## Формат summary

`schemaVersion:1`: `issue`, `baseCommit`, `mode` (baseline|treatment), `environment`, `contextSources`, `kbNotes`, `commands[{cmd,status}]`, `failure{scenario,checkpoints,firstMismatchTick}`, `diagnosis{rootCause}`, `fix{diffSha256}`, `retest[]`, `iterations`, `elapsedSeconds`, `tokens` (`not_measured` либо `measured`+`source`+`total`), `artifacts`, `limitations`, `cleanup{clean}`, `readyForReview`. Проверка: `node scripts/agent-loop-summary.mjs validate`. Структурная валидность допускает незавершённые/failed эксперименты (`readyForReview:false`); `readyForReview:true` дополнительно требует `cleanup.clean:true` и все `retest` = PASS; PR-блок: `render`.

## Шаблон PR handoff

```text
Feedback-loop (treatment) — issue #N, base <sha10>
- Сбой: <scenario>, checkpoints: <ids>, firstMismatchTick: <n>
- Root cause: <1 предложение + source>
- Fix: diff sha256 <12>   - Итерации/elapsed/tokens: …
Команды / Retest: список `cmd → status`   Ограничения: …
```

## Решение: Iterate

- **Adopt как optional**: route даёт checkpoint-level FAIL/PASS, воспроизводимый handoff и не увеличивает bootstrap заметно (+197 Б).
- **Не доказано**: снижение токенов/времени — в n=1 Treatment дороже (+25 % токенов, ×2,25 tool uses, ×7,5 времени), причём частично из-за нарушения инструкции baseline и сломанного KB в snapshot.
- Следующая итерация: повторить на ≥3 разных дефектах с history-preserving окружением (KB работает), логировать timestamps команд, одинаково требовать чтение AGENTS.md. Не расширять route до required.
