# AT2 / #102 — Knowledge Base verification

Решение: **Iterate**. Три verified notes дают точечный retrieval и меньший объём выданного текста в двух упражнениях, но этот pilot не доказывает экономию wall-clock времени Coding Agent или tokens. CLI пригоден для selective engineering lookup; расширять notes по реально решённым incidents, перепроверять источники при drift.

## Методика и окружение

2026-10-13, Darwin arm64, Node v25.9.0, pnpm 10.8.1; task base `bb12e69`, gameplay source не изменён. CI отдельно запускается на Node 22. Один автор, одна session, n=1 на вариант; A выполнен до написания notes, B после index/search implementation. Задачи:

1. Почему blocked-target group MOVE был дорогим, какой cache применён и гарантирует ли он tick <=100 ms?
2. Что происходит с pending MOVE/recipient events/Owner/Controller при permanent leave и reconnect grace?

Ожидаемые ответы заранее определены из live Issues #87/#54, merged PR #92/#73 и ADR-009. Автор реально выбирал и выполнял команды поиска/чтения, затем формулировал ответы по полученному тексту. Это авторский lookup pilot, **не независимый blinded agent experiment** и не автоматическая имитация reasoning. Предварительное исследование для реализации и знакомство с кодом присутствуют в обоих вариантах; порядок A→B даёт learning bias. Исторические performance numbers взяты из источника, новый navigation benchmark для AT2 не заявлен.

Recorder оборачивает каждую фактически выбранную shell-команду через subprocess, пишет command/stdout/stderr/exit, bytes UTF-8 stdout и elapsed `perf_counter`. Полный журнал: `.artifacts/verification/102/retrieval.jsonl` (ignored). Recorder/seed helpers и полные diagnostics не коммитятся. Метрики ниже — суммы трёх retrieval-команд на pilot snapshot (позже добавлены fingerprints CI/AGENTS/ADR-008 без изменения ответов); compound shell command считается одним действием, отдельные внутренние operations раскрыты ниже.

| Задача | Вариант | Команды / операции | Выдано stdout, bytes | Сумма elapsed команд, s | Ответ |
| --- | --- | --- | --- | --- | --- |
| Navigation | A без KB | 3 / 5 | 38 765 | 0.059753 | Все 5 критериев найдены |
| Navigation | B с KB | 3 / 6 | 9 296 | 0.347705 | Все 5 критериев найдены |
| Permanent leave | A без KB | 3 / 6 | 11 640 | 0.075407 | Все 5 критериев найдены; один failed path lookup |
| Permanent leave | B с KB | 3 / 6 | 8 088 | 0.348364 | Все 5 критериев найдены |

Byte counts — реально измеренный **выданный контекст команд**, не token usage и не точный объём чтения моделью: широкие A tool outputs были частично усечены UI/tool budget, raw stdout сохранён. Общий time от постановки вопроса до reasoning-ответа не измерялся; командные timings включают spawn/process overhead и I/O, исключают чтение/думание/ожидание tool roundtrips. B медленнее на этих командах из-за Node startup и полной validation; уменьшение elapsed task time не доказано. Telemetry tokens недоступна — **не измерено**. Не выводим проценты экономии или статистическую confidence из n=1.

### Файлы и реальные действия

Navigation A:

- `rg -n "component|cache|100 ms|blocked" docs/verification/87*/README.md packages/simulation/src/navigation*`: поиск в 8 candidate files (7 navigation* + report).
- `sed -n "17,58p;99,110p" docs/verification/87-navigation-cpu/README.md; cat packages/simulation/src/navigation-components.ts; sed -n "249,335p" packages/simulation/src/navigation.ts`: report/code, 3 read operations.
- `git show 7f049ca --stat`: provenance summary; diff не включался в byte metric.

Navigation B: `node scripts/knowledge-base.mjs search "blocked target" --component navigation --limit 3`, `show navigation-component-cache`, затем `sed` sections navigation-components.ts (22–48), navigation.ts (249–285), navigation-component-cache.test.ts (152–184), report (99–106). Открыта одна note + 4 первичных файла. CLI внутри читает/валидирует 3 notes и fingerprints, но выдаёт только selected result/note; внутренний filesystem I/O не равен агентному контексту и отдельной метрикой не измерялся.

Permanent leave A:

- `rg -n "removePlayer|pending commands|grace" packages/simulation/src/match-runtime* apps/game-server/src/simulation-host*`: 2 существующих candidate files, отсутствующий старый host path → exit 2; failure не исключён из измерения.
- `sed` match-runtime.ts (250–278), match-runtime.test.ts (269–326), `rg -n "removePlayer|grace" apps/game-server/src`: ещё 16 candidate server source files searched, подходящие lines surfaced.
- `git show 5443b18 --stat; sed -n "32,57p" docs/adr/009-shared-match-runtime-and-adapter-boundary.md`: provenance и ADR.

Permanent leave B: `search "pending MOVE" --component runtime --limit 3`, `show permanent-leave-queue`, затем `sed` match-runtime.ts (259–269), match-runtime.test.ts (269–323), foundation-room.ts (185–202, 221–233), ADR-009 (40–48). Открыта одна note + 4 первичных файла. Для A число candidates searched больше числа файлов, из которых показаны полезные lines; это не утверждение, что весь файл был прочитан агентом.

### Проверка правильности/полноты

По пяти проверяемым фактам для каждого вопроса (ручная сверка с code/tests/report, не самооценка confidence):

- Navigation A/B: baseline повторял flood-fill; labels по SpatialGrid identity/revision; destination reuse только внутри MOVE; routes отдельные и invalidation после topology change; residual churn/no-path p95 100.515 ms, CPU-bound не гарантирован. Все пять присутствуют в найденных источниках и итоговом ответе.
- Leave A/B: удалить pending queue; удалить outbox removed recipient; сохранить entity/Owner и снять Controller; permanent onLeave вызывает cleanup; onDrop/grace не вызывает cleanup. Regression tests подтверждают pending=0/no events/no displacement после removal и MOVE при grace. Все пять присутствуют.

Третья note — #89 workflow/naming, source PR #90: validator/tests/current handoff inspected, live Issue closed/PR merged. Это policy improvement; runtime incident не выдуман. В notes distinction historical #53 finding vs current runtime и superseded session-manager advice сохранён.

## Негативные проверки и воспроизводимость

`node --test scripts/knowledge-base.test.mjs` — 12 tests после review corrections, включая:

- invalid/unsupported YAML, unknown/missing/duplicate fields, empty sections, invalid status, oversized note;
- duplicate titles/body/filename mismatch, duplicate list items и affected paths;
- missing file/modified fingerprint → stale warning, missing commit/malformed URL/traversal/symlink → fatal failure;
- fake OpenAI/GitHub/AWS key patterns, credential assignments/private-key/email/user-path rejection; error redacts values;
- no-result `quantum-rutabaga` и typo `blokced` → `[]`, exit 0; unknown show/options/invalid limit → fail;
- ranking/filter/AND/tie/order/bounds и deterministic index даже при reverse discovery;
- temporary clean Git clone с candidate notes/source files, без node_modules/build: check/index reproducible, два index builds byte-identical.

`pnpm kb check --online` реально подтвердил доступность и resolved/merged state Issues/PR для всех трёх notes. Offline check проверяет URL shape + local commit ancestry/file hashes, **не remote availability**. Future deletion/reopen remote source обнаруживается online check; отсутствие сети/auth приводит к failure, не PASS. Semantic drift вне перечисленных source files и неизвестные secret/PII patterns не гарантированно обнаруживаются: ручной review остаётся необходимым.

## Проверки и границы

Локально прошли `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:server`, `pnpm kb check --online`, `pnpm test:kb`, branch-name tests. Turbo workspace checks использовали существующий content-addressed cache; KB tests исполнялись заново. Отдельно реально выполнены 43 source regression tests navigation-component-cache/navigation-move/match-runtime (3 files). CI evidence указывается в PR на exact head; подробные logs — `.artifacts/verification/102/`. Gameplay/runtime/renderer не меняются, browser screenshots для AT2 tooling не требуются. Existing full-CI browser/Docker jobs сохраняются.

Job `knowledge-base` без install выполняет tests/check/index, gate требует success и для docs-only PR; тяжёлые docs-only jobs не включаются. GitHub run на промежуточном head обнаружил shallow checkout в `unit-tests`: root `pnpm test` также вызывает KB tests и не находил provenance commits. Исправлено `fetch-depth: 0` для этого job (у knowledge-base уже full history); validation не ослаблялась. Полный pipeline на этой implementation PR проверяет tooling изменение как обычно.

Project Status Check: **Required** — добавлен устойчивый selective retrieval workflow и AT2 checkpoint; docs/project-status.md обновлён без transient SHA/PR/CI.

Reference: [Universal Modder](https://github.com/rehan-remade/universal-modder/tree/5ba8150e27b4f1bf17ae19dcecdb2341e467885a), `um/kb.py` и knowledge note sections/schema/search изучены, GitHub license API сообщил MIT. Использованы идеи, код не копировался. Python/remote publishing/game-specific stack не перенесены. AT3–AT9 не реализованы.

## Исправления архитектурного review (2026-10-14)

Ветка перебазирована на актуальный main после merged camera verification fix #113. Drift больше не блокирует всю KB: effective stale status, исключение из search/index, show только диагностики reverification, check/CI exit 0 с явным числом stale. Fingerprints сохраняются как freshness evidence, но не становятся обязательной зависимостью каждого будущего PR. Schema/secrets/PII/path safety/duplicates/commit provenance остаются fail-closed для всей базы. Missing remote source (online HTTP 404) — stale; auth/network failure не выдаётся за успешно проверенный источник.

Regression fixtures реально меняют/удаляют один source и подтверждают retrieval другой note, отсутствие stale result/verified header, warnings/exit 0, восстановление после возврата исходного content; all-stale search даёт `[]`. Fatal negative проверяются даже при одновременном drift: fake key/schema/unsafe path/missing commit/duplicate/symlink. Mocked GitHub 404 и auth error проверяют классификацию и redaction; реальные доступные sources проверяются `check --online`. Также реально выполнен весь 12-test KB suite в temporary clean clone после harmless edit AGENTS.md, затем повторно после удаления navigation-components.ts: оба suite PASS, check сообщал 1/2 stale, поиск runtime note продолжал работать. Raw commands/results — `.artifacts/verification/102/review-drift-proof.json` (ignored). Новые тесты policy не являются новым A/B retrieval benchmark; исходные измерения выше остаются historical pilot. Final exact-head CI evidence публикуется в PR #111.

Project Status Check для corrections: **Not required** — исходное изменение AT2 checkpoint уже включено в PR; review fixes уточняют freshness policy внутри того же stage, не меняя roadmap/architecture.
