---
name: web-rts-feedback-loop
description: >
  Опциональный маршрут для defect/regression-задач Web RTS, где есть воспроизводимый
  headless-детектор (pnpm verify:gameplay): hypothesis → FAIL → diagnosis → targeted fix →
  retest → compact PR handoff. Не читать для docs-only, чисто визуальных и feature-задач без
  детектора. Не заменяет AGENTS.md, ADR, spec или review.
---

# Web RTS feedback loop (опционально)

Загружать только по запросу или когда задача — регрессия/дефект, которую можно воспроизвести командой. Контракт — `AGENTS.md`; этот файл ничего из него не дублирует и не ослабляет (scope, ADR, CI, no auto-merge, manual merge остаются).

## Цикл

1. **Context.** Обязательный bootstrap `AGENTS.md` уже сделан. Дополнительно — только затронутые исходники и ADR из issue. `pnpm kb search "<симптом>" --component <c> --limit 3` → `pnpm kb show <id>` для 1–2 top notes; сверить note с текущим кодом (note — память, не истина). Нет результата — обычный grep.
2. **Hypothesis + oracle.** До правок записать одной строкой: нарушенный invariant, ожидаемый failing check, команда. Каталог: `pnpm verify:gameplay --list`, `pnpm verify:mutation --list` (там же invariant и detector IDs).
3. **Reproduce FAIL.** Запустить минимальный детектор (`pnpm verify:gameplay <scenario>`). Сохранить JSON. Без FAIL до fix не переходить к правке: если PASS — гипотеза/детектор неверны.
4. **Diagnose.** Читать из report только `status`, `firstMismatchTick` и checks со `status:"FAIL"` (`id`, `expected`, `actual`); `firstMismatchTick` — первый *наблюдаемый* checkpoint, не доказанный causal tick. Затем идти к коду (`rg` по symbol из check) и сверить с ADR-границей. Записать root-cause гипотезу.
5. **Fix.** Минимальный targeted diff в рамках issue. Не ослаблять тест/oracle, не править fixture под код.
6. **Retest.** Тот же детектор → PASS; затем regressions по scope: смежные `verify:gameplay` scenarios и unit tests пакета. `verify:mutation <id>` — только для проверки качества oracle и только на clean tree (он сам создаёт disposable worktree); полную matrix не запускать. Browser (`verify:browser`) — только для player-visible изменений и не доказывает queue/simulation инварианты.
7. **Handoff.** Записать summary (`docs/verification/108-coding-agent-feedback-loop/README.md#формат-summary`), проверить `node scripts/agent-loop-summary.mjs validate <file>` и вставить вывод `... render <file>` в PR. Не merge'ить.

## Лимиты

- Не более 3 repair iterations без нового hypothesis; после — остановиться и описать блокер.
- Не загружать всю KB, все specs или skills; не добавлять LLM/API/БД/новый runtime.
- Токены в summary — только из provider telemetry, иначе `not_measured`.
