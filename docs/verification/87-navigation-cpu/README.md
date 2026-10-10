# #87 — CPU blocked-target navigation

Контракт: Issue #87; Spec #002 §8.1–8.8, §22, §25, §27, §29; ADR-004/008/009.

## Baseline до изменения алгоритма

`origin/main`: `9507da838f6519c1ce3b0f05e3ddbf20170a8bfc`. Алгоритм navigation не изменён. Apple M1, 8 logical CPUs, 16 GiB RAM, macOS Darwin 24.6.0 arm64, Node **v25.9.0**, pnpm 10.8.1. Это другое runtime, чем исторический Node 22 baseline #68; сравнение before/after будет внутри текущего runtime.

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/benchmark-navigation.mjs docs/verification/87-navigation-cpu/before-matrix.json
node --expose-gc scripts/benchmark-navigation-tick.mjs docs/verification/87-navigation-cpu/before-tick.json
node --expose-gc scripts/benchmark-navigation-lifecycle.mjs docs/verification/87-navigation-cpu/before-lifecycle.json
```

Прогоны последовательные, без tests/build/dev processes одновременно. ОС не изолирована. Compiled JS; 5 warm-ups, 30 samples; nearest-rank p50/p95, min/max, GC/outliers включены. Setup исключён; deterministic counters собраны отдельно от timings. Hardware timing не является CI assertion.

`before-matrix.json` — исходная 48-workload matrix без изменений: 40/80/128/256 × connected/partitioned × reachable/blocked × 1/8/16. Fallback+A*+smoothing, distinct continuous origins. Connected 256/16 blocked: **81.841 / 97.503 ms p50/p95**, min 73.755, max 108.933; 1 048 512 component visits, 4 000 A* expansions. Результат historical #68 (162.554 / 174.291) не заменяется этим baseline.

`before-tick.json` разделяет:

- **production** `MatchRuntime.step()` — настоящий Foundation 40×40, 4 players × 4 single-unit commands, cost=16. Переданный mapId намеренно не меняет карту. p50/p95 **1.648 / 2.862 ms**. Production AI отсутствует, activeTaskQueries=0, aiQueries=0.
- **synthetic full tick** — isolated `World` на 40/80/128/256, настоящий `scheduleCommands`, command application, `World.step()` movement/replan, event drain, затем явно синтетический AI lane. 16 distinct units группового MOVE + 8 accepted active tasks с unsafe segments + 12 AI requests, из которых budget разрешает 8, ascending IDs, max one query/entity. Command reservation=16, activeTaskQueries=8, synthetic aiQueries=8; lanes независимы. AI queries используют blocked resolution как дорогой synthetic workload, а не существующий G9 AI. Отдельный 256 workload содержит 16 single commands вместо одного group MOVE. Production snapshot/replication в synthetic harness не добавлены.

Connected 256 saturated tick: **114.360 / 123.008 ms**; churn **115.296 / 131.841 ms**; 16 single commands **111.841 / 123.081 ms**. Все превышают 100 ms интервал уже по p50. Distinct-components вариант использует full-height wall и alternating origins по её сторонам; effective destinations различаются. Churn включает успешный add/remove solid и последующий navigation work; active segment был отдельно invalidated при setup.

`before-lifecycle.json` — single/group requests на одном grid: cold/warm, add/remove + resolution, 10 повторных MOVE при стабильной topology. В baseline persistent cache отсутствует: cold/warm оба вычисляют компоненту снова, retained cache=0, rebuild означает следующий полный обход после изменения topology. Результаты включают отдельно измеренные deterministic counters.

Memory: `heapDeltaBeforeGC` — end-of-call heap delta, **не peak и не total allocations**; `heapDeltaAfterGC` содержит retained routes/world state и шум V8, может быть отрицательной. `arrayBufferDelta` зависит от момента finalization V8. Дополнительно lifecycle собирает approximate allocated heap bytes через Node HeapProfiler sampling (32 KiB, включая собранные GC objects), отдельно от timings. Это статистическая оценка temporary allocations, не точный byte accounting; typed-array backing stores учитываются отдельно структурной оценкой. Baseline не удерживает resolution cache между requests.

Baseline сохраняется отдельным коммитом до production algorithm changes. Дальнейшее сравнение A/B, выбранное решение, tests/browser evidence и after results добавляются ниже.
