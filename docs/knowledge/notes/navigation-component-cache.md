---
id: "navigation-component-cache"
title: "Blocked-target MOVE: повторный обход компонент"
component: "navigation"
tags: ["blocked-target", "cache", "topology", "cpu"]
context: "Проверено на main bb12e69 (2026-10-13); применимость зависит от fingerprints sources и текущих ADR/spec."
status: "verified"
issues: ["https://github.com/Web-Usov/web-rts/issues/87"]
prs: ["https://github.com/Web-Usov/web-rts/pull/92"]
commits: ["https://github.com/Web-Usov/web-rts/commit/7f049ca05539d4fe358aa215596a62d7f627126b"]
sources: ["packages/simulation/src/navigation-components.ts@3893e81640f52ff52a9108cbdf75becbe4bdd063c6d6c12f412da434d27cdc75", "packages/simulation/src/navigation.ts@ebc2de8aa67ab2651e538aac9dc823b9e793c1441cd136369d152ed519cb02a5", "packages/simulation/src/navigation-component-cache.test.ts@605145c603f3f938c4eec4b6a47ac07c9d99948c1f5b00185b84418638b6d336", "docs/verification/87-navigation-cpu/README.md@63d3eb00039a20926e80a5ebf7901b4a05ec1f84cf30f272a989ae47e7d1de9e", "docs/adr/008-grid-occupancy-deterministic-navigation.md@fce48261e769ee0ec1fa4fa5e9c8526823bb65a3526cd8370cb50c8d9cf71eea"]
---
# Blocked-target MOVE: повторный обход компонент

## Симптом

Blocked-target MOVE группы повторно обходит одну reachable component; query-count cap не гарантирует CPU budget tick. Применимо при profiling дорогого fallback к занятой цели.

## Причина

В baseline #87 fallback flood-fill выполнялся для каждого origin: connected 256×256 / 16 units давал 1 048 512 visits. Это установлено before-matrix и diff PR #92; не утверждение о текущей стоимости.

## Решение

Lazy component labels в WeakMap по identity SpatialGrid и topologyRevision; при revision change запись заменяется. MoveTargetResolution переиспользует projected destination по component только внутри одного MOVE. Routes/A* остаются отдельными для каждого origin. Reachable exact target не требует labels.

## Проверка

Открыть navigation-components.ts и MoveTargetResolution в navigation.ts; сверить invalidation с navigation-component-cache.test.ts. Выполнить `pnpm --filter @web-rts/simulation exec vitest run src/navigation-component-cache.test.ts src/navigation-move.test.ts`. Для timing: `pnpm build`, затем `node scripts/benchmark-navigation.mjs .artifacts/verification/navigation.json`, без параллельной нагрузки. Исторические before/after: docs/verification/87-navigation-cpu/README.md, connected 256/16 baseline p50/p95 81.841/97.503 ms; B warm 2.020/2.219 ms, cold 3.427/3.781 ms.

## Ограничения

Не делить routes между origins, не кэшировать по mapId. Projection world-space с inset 0.0001, squared distance и row-major tie-break; effective destination фиксирована на task. No-op topology не invalidates cache. Churn/no-path final p95 100.515 ms: failed A* остаётся риском, CPU-bound tick не доказан. Эти historical timings не прогноз текущего runtime; work-unit/resumable budget требует spec/ADR, а не молчаливой оптимизации.
