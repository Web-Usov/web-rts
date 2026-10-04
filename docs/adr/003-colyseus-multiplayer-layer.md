# ADR-003: Colyseus multiplayer layer

Статус: **Accepted**  
Дата: **2026-09-24**  
Уточнение integration boundary: **2026-10-04**

## Контекст

Multiplayer foundation требует room lifecycle, WebSocket transport, reconnect, session handling и state synchronization. Писать этот инфраструктурный слой с нуля не даёт продуктового преимущества и увеличивает объём кода для агентов.

## Решение

Использовать **Colyseus** как multiplayer/session/networking layer.

Colyseus отвечает за:

- create/join room;
- WebSocket transport;
- player sessions;
- reconnect;
- room lifecycle / room lock;
- transport-level rate/phase checks;
- delivery of protocol state/event messages;
- возможный будущий lobby/matchmaking layer.

Colyseus **не является simulation engine** и не содержит самостоятельных gameplay rules.

Актуальная integration boundary после ADR-009:

```text
Colyseus Room shell
   ↓ validated wire command + trusted session actor
@web-rts/match-adapter
   ↓ internal SimulationCommand
MatchRuntime (@web-rts/simulation)
   ↓ MatchSnapshot / RuntimeEvent
@web-rts/match-adapter
   ↓ recipient GameStateView / GameEvent
Colyseus transport
```

Current baseline использует full `GameStateView` messages. Colyseus Schema/delta synchronization может быть добавлена позже как measured transport optimization и не является canonical world model.

## Последствия

Плюсы:

- меньше собственного networking boilerplate;
- готовая room/session abstraction;
- reconnect и room/session primitives доступны на foundation-этапе;
- хорошо сочетается с TypeScript/Node.js.

Минусы:

- появляется framework dependency в server/network layer;
- full-view replication может потребовать delta/Schema/binary optimization при большом числе entities;
- часть поведения reconnect/replication зависит от API Colyseus.

## Альтернативы

### Raw WebSocket / ws

Отклонено на старте: потребует самостоятельно реализовать rooms, sessions, reconnect и replication plumbing.

### Socket.IO

Не выбран: хорошо решает transport/events, но даёт меньше game-specific room/state primitives для нашего сценария.

### WebRTC/P2P

Не используется как основа multiplayer foundation.

## Инварианты

- Colyseus types не проникают в `packages/simulation`;
- Room не является world state;
- замена replication strategy не должна требовать переписывания gameplay rules;
- Room/session shell не выполняет gameplay semantic validation;
- shared MatchRuntime + match-adapter boundary определяется ADR-009;
- public game commands описываются в `packages/protocol`, а не неявно внутри Room handlers.
