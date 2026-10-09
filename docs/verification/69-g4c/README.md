# G4c / #69 — измерения оптимизаций

Дата: 2026-10-09. Baseline — exact head `822d0f58dccbcd64801a6d079c7cc9a7a8c73248` до optimization changes. Итоговая реализация — `optimized-arrays`.

## Условия и метод

Apple M1, macOS (`darwin/arm64`), Node **v25.9.0**, одинаковые размеры карт, topology, goals и callback. 100 warmup queries + 101 отдельно измеренная query на сценарий; median и nearest-rank p95 в миллисекундах. Это локальный diagnostic benchmark, а не оценка CI runner (CI использует Node 22) или timing gate.

`benchmark-navigation-breach.mjs` читает baseline через `git show`, transpiles TypeScript установленным compiler и запускает uninstrumented query. Timing (`performance.now`) живёт только в script. Counters снимаются отдельным invocation через benchmark-only source instrumentation; результат сверяется с uninstrumented query. Production planner не имеет diagnostic API, clocks или counters. Экспериментальные BigInt/word-bitset/BFS варианты создаются только в памяти script, не попадают в simulation build.

`generated` — число принятых labels, отправленных в heap (включая initial); `expanded` — число non-stale pops, включая goal. `peakHeap` включает stale entries. `peakActive` — maximum nondominated labels во всех клетках, включая уже expanded labels. `removed` и `stale` показывают фактическое удаление dominated labels и пропуск их heap entries. Для baseline `peakActive` — число записей best-state Map. Эти counters детерминированы, в отличие от timing.

`heapDeltaBytes` — median трёх **отдельных** разностей heapUsed до/после query, с forced GC перед каждой query. Это transient allocation diagnostic, не peak RSS или retained memory: GC/JIT могут менять результат, в том числе во время query. `arrayBufferDeltaBytes` сохраняется отдельно; малыe typed arrays могут иметь backing store внутри V8 heap. Память не используется как CI assertion.

JSON содержит Node/CPU, параметры, source SHA-256 и все raw counters. Повторный запуск может дать другие timing/heap deltas; наиболее надёжное доказательство algorithmic gain — labels и exact oracle.

## Before / after

| Сценарий | Median before, мс | Median after, мс | p95 before, мс | p95 after, мс | Generated before → after | Expanded before → after |
|---|---:|---:|---:|---:|---:|---:|
| small-open | 0.061 | 0.058 | 0.109 | 0.112 | 59 → 59 | 31 → 31 |
| one-wall | 0.090 | 0.046 | 0.253 | 0.070 | 164 → 163 | 136 → 136 |
| fortified-bottleneck | 3.061 | 1.361 | 4.206 | 2.357 | 6297 → 3496 | 5307 → 2747 |
| fortified-multi-goal | 3.195 | 1.337 | 4.622 | 2.393 | 5821 → 3020 | 5307 → 2747 |
| serial-16-blockers | 0.388 | 0.016 | 0.701 | 0.021 | 259 → 33 | 258 → 33 |
| serial-32-blockers | 2.358 | 0.033 | 3.659 | 0.054 | 1027 → 65 | 1026 → 65 |
| serial-65-blockers | 19.328 | 0.058 | 27.454 | 0.083 | 4228 → 131 | 4227 → 131 |
| equivalent-corridors | 0.404 | 0.166 | 0.926 | 0.307 | 874 → 493 | 761 → 401 |
| static-barrier | 0.229 | 0.109 | 0.751 | 0.267 | 480 → 480 | 480 → 480 |
| combinatorial-no-route | 26.669 | 0.040 | 29.298 | 0.063 | 25214 → 127 | 24576 → 117 |
| combinatorial-five-gates | 0.980 | 0.141 | 1.447 | 0.555 | 1498 → 252 | 1332 → 220 |
| static-maze | 0.233 | 0.168 | 0.768 | 0.790 | 638 → 638 | 540 → 540 |

## Frontier и память

| Сценарий | Peak heap before → after | Peak active before → after | Heap delta before → after, KiB | Removed / stale after |
|---|---:|---:|---:|---:|
| small-open | 29 → 29 | 59 → 59 | 38.0 → 55.6 | 0 / 0 |
| one-wall | 30 → 30 | 164 → 163 | 129.7 → 182.4 | 0 / 0 |
| fortified-bottleneck | 811 → 501 | 5821 → 3020 | 6099.8 → 3189.1 | 476 / 476 |
| fortified-multi-goal | 761 → 367 | 5821 → 3020 | 6309.2 → 3431.2 | 0 / 0 |
| serial-16-blockers | 2 → 1 | 259 → 33 | 578.5 → 63.4 | 0 / 0 |
| serial-32-blockers | 2 → 1 | 1027 → 65 | 3652.7 → 122.9 | 0 / 0 |
| serial-65-blockers | 2 → 1 | 4228 → 131 | 25245.3 → 276.9 | 0 / 0 |
| equivalent-corridors | 124 → 85 | 820 → 439 | 930.0 → 517.8 | 54 / 54 |
| static-barrier | 40 → 40 | 480 → 480 | 390.3 → 639.3 | 0 / 0 |
| combinatorial-no-route | 1050 → 58 | 24576 → 117 | 27100.8 → 154.0 | 10 / 10 |
| combinatorial-five-gates | 190 → 36 | 1479 → 252 | 1970.4 → 260.7 | 0 / 0 |
| static-maze | 30 → 30 | 569 → 569 | 534.6 → 699.3 | 69 / 69 |

## Измеренные кандидаты

Все candidates используют тот же exact dominance search. В клетках с равными cost и cellId mask candidates выбирают минимальный differing **numeric entityId**, независимо от ordinal assignment. BigInt не имеет лимита 64 bits; word-bitset использует произвольное количество Uint32 words и unsigned normalization. Сценарий с 65 sparse uint32 IDs проверяет переходы через 32 и 64. Mask candidates сверяются с полным результатом array search на всех fixtures (включая route/first blocker). Reverse BFS сверяется по status/breachCount/pathLength, поскольку другая admissible h может менять equal-cost route.

В таблице — median, мс; raw p95 и memory находятся в JSON.

| Сценарий | Arrays (итог) | Reverse BFS + arrays | BigInt | Multiword bitset |
|---|---:|---:|---:|---:|
| small-open | 0.058 | 0.178 | 0.058 | 0.059 |
| one-wall | 0.046 | 0.073 | 0.054 | 0.059 |
| fortified-bottleneck | 1.361 | 1.345 | 1.726 | 1.257 |
| fortified-multi-goal | 1.337 | 1.261 | 2.043 | 1.298 |
| serial-16-blockers | 0.016 | 0.017 | 0.016 | 0.037 |
| serial-32-blockers | 0.033 | 0.036 | 0.070 | 0.031 |
| serial-65-blockers | 0.058 | 0.067 | 0.056 | 0.059 |
| equivalent-corridors | 0.166 | 0.187 | 0.143 | 0.098 |
| static-barrier | 0.109 | 0.043 | 0.094 | 0.090 |
| combinatorial-no-route | 0.040 | 0.002 | 0.052 | 0.044 |
| combinatorial-five-gates | 0.141 | 0.090 | 0.177 | 0.122 |
| static-maze | 0.168 | 0.148 | 0.182 | 0.169 |

**Выбор:** production оставляет sorted ID arrays и Manhattan. После dominance устранены `sort/join` и строковые state keys; добавление entity выполняет ordered insertion, reentry переиспользует array, subset scan имеет identity/empty-set/early-match fast paths.

Reverse BFS проверен как один preprocessing внутри breach invocation: normal cells и только callback-approved movement-blocking footprints traversable; static/non-breachable cells непроходимы. BFS даёт exact relaxed distance, которая является admissible lower bound реальной длины. Он устраняет весь label search на двух `no_route` fixtures и сокращает maze expansions; цена preprocessing в small-open — примерно 3× времени итогового array query, без сокращения labels. В fortified cases почти все labels всё равно необходимо рассмотреть прежде, чем перейти к большему breachCount. Без доказанного workload с преобладанием `no_route` эта цена не добавлена к каждой query. Эксперимент не заменяет normal A* и не создаёт AI phase/query.

Компактные masks не дают устойчивого общего выигрыша: BigInt ухудшает fortified median; words быстрее на equivalent corridors и немного на fortified, но медленнее на serial-16, не улучшает serial-65 и требует ordinal mapping/дополнительного cost field/другого tie comparison. Array representation выбрана по всему набору, с сохранением простого numeric tie-break и отсутствием лимита entities. Это не утверждение, что bitsets всегда медленнее: при другом распределении B/workload потребуется новое измерение.

## Корректность и ограничения

Dominance применяется **только** при одинаковом cellId, `A.breached ⊆ B.breached` и `gA <= gB`. Для любого suffix S получаем `A ∪ S ⊆ B ∪ S` и не более длинный итоговый path. Более короткий superset сохраняется, равно как incomparable sets. При равном identical label сохраняется первый parent; очередь по-прежнему использует `breachCount → g+h → h → cellId → numeric breached IDs`, fixed neighbor order и Manhattan. Parent links сохраняются для корректного route/first blocker даже после удаления ancestor label из frontier.

131 simulation tests проходят, включая исходный 256-query oracle и новый 256-query four-blocker/multi-cell/hostility oracle, forbidden-pruning map `{}` g=5 vs `{A}` g=3, reentry и 31/32/33/63/64/65/96 blockers. Все исходные normal-navigation/MOVE regressions сохраняются. Состояние grid/topology и callback contract не меняются.

Worst-case остаётся экспоненциальным (`O(V × 2^B)` потенциальных labels). Dominance scan линейный по frontier данной клетки и размеру набора; при множестве incomparable labels это тоже может быть дорого. Arbitrary search caps/timeouts, resumable search, approximation, G4b/G9 changes отсутствуют. p95/heap deltas не улучшаются равномерно на каждом сценарии и не являются fixed-tick latency guarantee.

## Повторение

Из корня task worktree, с тем же Node:

```bash
pnpm install --frozen-lockfile
pnpm --filter @web-rts/game-data build
pnpm --filter @web-rts/simulation build
node --expose-gc scripts/benchmark-navigation-breach.mjs --revision 822d0f58dccbcd64801a6d079c7cc9a7a8c73248 --label baseline --output docs/verification/69-g4c/baseline.json
node --expose-gc scripts/benchmark-navigation-breach.mjs --label optimized-arrays --output docs/verification/69-g4c/optimized-arrays.json
node --expose-gc scripts/benchmark-navigation-breach.mjs --reverse-bfs --label optimized-reverse-bfs --output docs/verification/69-g4c/optimized-reverse-bfs.json
node --expose-gc scripts/benchmark-navigation-breach.mjs --representation bigint --label optimized-bigint --output docs/verification/69-g4c/optimized-bigint.json
node --expose-gc scripts/benchmark-navigation-breach.mjs --representation words --label optimized-words --output docs/verification/69-g4c/optimized-words.json
```

Сценарии: small-open 16×16; one-wall 16×16; fortified 32×16 с 16 альтернативами первого blocker и одним общим вторым footprint (1/16 goals); serial 16/32/65 1-cell blockers; equivalent corridors 25×9 с пятью gate choices в двух барьерах; static barrier 40×24; combinatorial no-route 24×5 с 8 optional blockers и static barrier; five-gates 17×3 с двумя blocker choices на каждый из пяти gates; static maze 36×24 с восемью чередующимися перегородками. Это диагностические synthetic layouts, не готовые PvE maps или gameplay integration.
