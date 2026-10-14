---
id: "permanent-leave-queue"
title: "Permanent leave: pending MOVE и stale recipient events"
component: "runtime"
tags: ["leave", "queue", "reconnect", "controller"]
context: "Проверено на main bb12e69 (2026-10-13); применимость зависит от fingerprints sources и текущих ADR/spec."
status: "verified"
issues: ["https://github.com/Web-Usov/web-rts/issues/54"]
prs: ["https://github.com/Web-Usov/web-rts/pull/73"]
commits: ["https://github.com/Web-Usov/web-rts/commit/5443b18d9e475a47291ea2a23dd7e00b1275cefd"]
sources: ["packages/simulation/src/match-runtime.ts@be5356f1ce0cfc461d2ab0693380c51ae07c726f243ec2b06d21f6e12c180f71", "packages/simulation/src/match-runtime.test.ts@62848a093eb2ac166239411dd3821253eea59f0786c90686c095c383b109f713", "apps/game-server/src/rooms/foundation-room.ts@68b09f55424b5d38bf8e80c49f8464211d83ec267126a29805fc3f1aad7b41c4", "docs/adr/009-shared-match-runtime-and-adapter-boundary.md@74d08a5d38ae2f37e6ec7d25e0eba120d85ef08553a702429f502601931b8cda"]
---
# Permanent leave: pending MOVE и stale recipient events

## Симптом

При permanent leave до следующего tick queued MOVE не должен исполниться; клиенту вышедшего игрока не нужны stale rejection events. Reconnect grace должен сохранять pending queue.

## Причина

Audit #53 H3 описывал проверку permissions при enqueue в Foundation до G1. Это исторический finding, не диагноз актуального main. G1 #54/PR #73 ввёл trusted actor и tick-boundary validation; permanent cleanup реализован отдельно от temporary drop.

## Решение

MatchRuntime.removePlayer удаляет per-player queue, undelivered outbox entries этого recipient и releases Controller; Owner/entity сохраняются. FoundationRoom.onLeave вызывает cleanup для permanent leave/timeout, onDrop ожидает allowReconnection и не вызывает removePlayer. Session timers принадлежат shell (ADR-009).

## Проверка

Открыть removePlayer в match-runtime.ts, regression tests `removePlayer discards pending commands`, `drops undelivered events`, `keeps the pending queue`; сверить onDrop/onLeave в foundation-room.ts. Выполнить `pnpm --filter @web-rts/simulation exec vitest run src/match-runtime.test.ts` и `pnpm test:server`. Regression setup: enqueue valid своего и invalid чужого MOVE, pending=2; removePlayer, pending=0; step, drainEvents=[]; position/Owner сохранены, Controller=null. В grace без removePlayer MOVE исполняется.

## Ограничения

Не удалять entity/Owner и не вызывать permanent cleanup на каждом drop. Контрольный runtime test grace моделирует отсутствие removePlayer, реальные timers/reconnect покрываются server integration. Исходный audit superseded ADR-009: не копировать предложение общего session manager или actor из client payload. Queue caps/fairness добавлены позднее G1; note не отменяет текущие budgets.
