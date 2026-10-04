# ADR-009: shared MatchRuntime and protocol/simulation adapter boundary

Статус: **Accepted**  
Дата: **2026-10-04**

## Контекст

ADR-006 зафиксировал один client `GameTransport`, но Foundation F11 оставил две application-side реализации match host:

- server Room/SimulationHost/mappers/projection;
- Local WebWorker runtime/mappers/projection.

Audit #53 подтвердил divergence: Remote не drain'ил simulation events, permissions проверялись до tick boundary, Local/Remote имели дублированную projection.

При росте command set в Spec #002 это создаст две gameplay semantics.

Одновременно `simulation` не должен импортировать `protocol`, а `protocol` не должен зависеть от simulation.

## Решение

### MatchRuntime

Framework-agnostic `MatchRuntime` живёт в `@web-rts/simulation` и является production facade gameplay execution.

Он владеет:

- World;
- shared match bootstrap/setup;
- command queue;
- tick-boundary semantic validation;
- gameplay systems/economy/waves/result;
- transport-neutral snapshot/events/metrics.

Runtime не владеет timers/wall-clock. Remote Room и Local Worker вызывают explicit `step()`.

Trusted host передаёт actor PlayerId отдельно от client gameplay intent. SessionId не входит в simulation.

Runtime drains gameplay events every tick. Command rejection/action failure остаются transport-neutral events с recipient PlayerId.

### Session/transport shells

Remote shell владеет Colyseus/session/auth/join/reconnect/room lock/rate limit/network logs/scheduler.

Local shell владеет WebWorker messaging/local identity/scheduler/disposal.

Transport internals намеренно не объединяются fake abstraction.

Audit #53 H1 предлагал общий host module также для phase lifecycle. ADR-009 принимает эту рекомендацию **частично и осознанно**: общий gameplay runtime/bootstrap/projection обязателен, но LOBBY/join/reconnect/room-lock lifecycle остаётся shell-owned. Local и Remote вместо общего session manager обязаны иметь одинаковые observable gameplay lifecycle semantics для START → RUNNING → FINISHED и parity/integration tests на эти переходы.

### Bridge package

Добавляется один production package:

```text
@web-rts/match-adapter
```

Dependency direction:

```text
game-data → simulation

protocol ─┐
          ├→ match-adapter → apps
simulation┘
```

Запрещены `simulation → protocol` и `protocol → simulation`.

`match-adapter` содержит pure:

- GameCommand → SimulationCommand mapping;
- MatchSnapshot + recipient/session context → GameStateView;
- RuntimeEvent → GameEvent.

Он не хранит authoritative state и не выполняет gameplay validation.

### GameTransport

Client session UI зависит от полного GameTransport contract, включая `startMatch`, connected room identity/resume capability/RTT, а не concrete PageGameTransport extension.

### Replication

Remote и Local используют один shared projector. Production app shells не читают World/component stores напрямую; используют runtime snapshot/events/metrics.

## Последствия

Плюсы:

- Solo/Remote реально имеют один gameplay path;
- permission/resources/placement проверяются одинаково на tick boundary;
- server/local rejection parity testable;
- simulation/protocol остаются независимыми;
- app shells становятся thin.

Минусы:

- появляется новый bridge package;
- требуется foundation refactor до новой gameplay complexity;
- session metadata всё равно остаётся в shells и не унифицируется полностью.

Новый package оправдан необходимостью зависеть одновременно от protocol + simulation без цикла. Отдельные packages для combat/economy/navigation/AI не создаются.

## Relationship to other ADR

- ADR-006 сохраняет client Local/Remote GameTransport boundary.
- ADR-007 сохраняет replication/visibility boundary и current full-snapshot strategy.
- ADR-009 описывает shared execution/integration boundary **за** transports.

## Инварианты

- one shared MatchRuntime gameplay semantics;
- trusted actor identity не приходит из client payload;
- gameplay semantic validation at tick boundary;
- event drain every tick;
- Local/Remote command/state/event adapters shared;
- simulation does not import protocol/framework APIs;
- application shells do not own gameplay rules;
- direct production access to mutable World stores avoided;
- reconnect/session/rate limits remain shell concerns;
- shell-owned session lifecycle may differ internally, but observable START/RUNNING/FINISHED gameplay semantics remain equivalent across Local/Remote.
