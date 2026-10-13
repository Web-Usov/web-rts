# AT1 / #98 — Headless gameplay verification

Эксперимент проведён 13 октября 2026 на base `6de22bff7af7f7203142bcc449a75ddc4e217ae0` (C1 #97). [Issue #98](https://github.com/Web-Usov/web-rts/issues/98) · [PR #99](https://github.com/Web-Usov/web-rts/pull/99) · [Gameplay Spec #002 §25–27](../../specs/002-first-economy-defense-vertical-slice.md). Node 25.9.0 / pnpm 10.8.1 в исходном эксперименте; CI — Node 22. Production gameplay, transport, protocol и renderer не менялись.

## Методика и воспроизведение

Готовый headless gate исполняет production simulation без GUI, server, LLM или внешнего API. JSON (schemaVersion 1, seed, commands, ticks, expected/actual, checks, observations и первый обнаруженный checkpoint расхождения) записывается в stdout; человекочитаемый итог — в stderr. Exit **0** = PASS, **1** = несовпадение, **2** = неверный request/ошибка.

```sh
pnpm install --frozen-lockfile
mkdir -p .artifacts/verification/gameplay
pnpm --silent verify:gameplay move > .artifacts/verification/gameplay/move.json
pnpm --silent verify:gameplay combat > .artifacts/verification/gameplay/combat.json
pnpm test:simulation
node tools/scenario-runner/dist/cli.js missing > .artifacts/verification/gameplay/unknown.json
echo $? # 2: invalid scenario is FAIL, never PASS
```

Проверка ошибочных expectations, испорченного observed state, пустого списка checks и неверных CLI arguments уже есть в `tools/scenario-runner/src/verification.test.ts`; её можно повторить командой `pnpm --filter @web-rts/scenario-runner exec vitest run src/verification.test.ts`. CI дополнительно сохраняет JSON заведомо неверного MOVE expectation, не изменяя gameplay-код.

## Реальные результаты (исходный эксперимент)

- **MOVE:** seed 98; player 0 / entity 1; команда `MOVE (4,-3)` на tick 0; 120 ticks. Проверены admission, точное прибытие, отсутствие rejection и tick count. **5/5 PASS**, byte-identical JSON, SHA-256 `2e275507c95fa289e50b1949c554e1efcb4250f90b8f883def50a87ebd4cd6e7`.
- **Combat:** seed 59; Soldier (-8.5,-8.5), PvE enemy 40 HP (-4.5,-8.5), MOVE на tick 1, 130 ticks. Проверены смерть enemy, выживание Soldier, состояние IDLE и отсутствие rejection. **5/5 PASS**, byte-identical JSON, SHA-256 `783c55c5762cec27a26a369e6052c3075c8dfd8583badeecf848f7a6717b56ad`.
- **Негативные проверки:** неверный target `(999,-3)` → FAIL / exit 1 / actual `(4,-3)` / checkpoint 120; временная controlled mutation `current -= profile.damage` → `current -= 0` в combat system → FAIL / exit 1 (enemy survived, Soldier not IDLE); после rollback → PASS / exit 0. Неизвестный сценарий и отсутствие аргументов → exit 2. Mutation была возвращена обратно; она **не** запускается автоматически в CI.
- **Duration** (5 wall-time повторов с pnpm startup/cache): MOVE 0.735–1.291 s, median 0.822 s; Combat 0.744–1.033 s, median 0.823 s; baseline Vitest combat (2 tests) 1.969–2.653 s, median 2.377 s. Это разные workloads; сравнение не является benchmark производительности симуляции.

Ручное повторение mutation выполняйте исключительно в disposable worktree: временно измените указанное выражение в `packages/simulation/src/systems/combat.ts`, выполните `pnpm --silent verify:gameplay combat` (ожидаемый exit 1), восстановите файл и повторите (exit 0). Не оставляйте mutation в ветке.

## Browser cross-check

Реально выполнены Local WebWorker flow (start → selection → MOVE) и Remote flow (две browser sessions A/B, команда A и видимое перемещение у B), проверены HUD, pixels/centroid, objective и console/pageerror. Исходный чистый локальный Playwright прогон: **10/10 passed**, 5.4 min. Предварительный прогон 8/10 при одновременной пересборке; причины обеих ошибок не установлены. На исходном CI head `f192ab54` первая попытка browser-e2e упала на visual camera centroid threshold (5 px); retry на том же head и весь `ci-gate` прошли. Порог не ослаблялся: [GitHub Actions, исходная попытка и retry](https://github.com/Web-Usov/web-rts/actions/runs/38389187831).

Для запуска и сохранения Local/Remote screenshots:

```sh
pnpm build
F7_SAVE_VERIFICATION_SHOTS=1 VERIFICATION_DIR=.artifacts/verification/browser pnpm test:e2e
```

Не запускать server integration параллельно с E2E: используется port 2568. Для ручного Vite + game-server потребуется `VITE_GAME_SERVER_URL=http://127.0.0.1:2568`. Browser подтверждает общую MOVE/nav семантику, **не** идентичный tick-by-tick replay headless fixture. Для BUILD/Combat публичного browser input/projection пока недостаточно.

## GitHub Actions artifacts

[Workflow CI для PR / chore/98](https://github.com/Web-Usov/web-rts/actions/workflows/ci.yml?query=branch%3Achore%2F98) · [PR Checks](https://github.com/Web-Usov/web-rts/pull/99/checks). В **каждом новом CI run** вкладка Artifacts содержит:

- `gameplay-verification-evidence` — `move.json`, `combat.json`, `wrong-expectation.json`, `unknown.json`, `malformed.json`, CLI stderr и `simulation-tests.log`. Позитивные и негативные reports формируются заново на head run.
- `playwright-e2e-artifacts` — Local/Remote screenshots (`running-local.png`, `after-move-local.png`, `running-a/b.png`, `after-move-a/b.png`), Playwright HTML report и `test-results/` (failure screenshot, trace и video при наличии).

Artifacts сохраняются **14 дней**; они привязаны к конкретному CI run и не хранятся в Git. Локальные результаты — в игнорируемой директории `.artifacts/verification/`. Ранее созданные вручную диагностика/внутренний browser screenshot и mutation JSON не выдаются за результаты нового CI: их факты зафиксированы в этом отчёте, но сырые файлы удалены из Git.

## Ограничения и решение

Gate проверяет конкретные ожидания через shared simulation: MOVE на `MatchRuntime`, Combat через existing World builder/`runScenario`. Он не заменяет Vitest regression suite, browser playtest, server integration, parity/security tests или независимый review. Checkpoint — первое **проверенное** расхождение, не доказанный causal tick. Нет гарантий bit-perfect cross-platform детерминизма, метрик token usage, autonomous bot/fuzzing или visual correctness для Combat/BUILD.

**Рекомендация: Iterate.** Сохранять небольшие headless regression fixtures; дальнейшее расширение инструментов и сценариев — отдельный AT3. Исполняемые сценарии и testkit в этом cleanup не менялись.

Project Status Check: **Not required** — roadmap и production invariants не меняются.
