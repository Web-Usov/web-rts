# ADR-003: Colyseus multiplayer layer

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

Multiplayer foundation требует room lifecycle, WebSocket transport, reconnect, session handling и state synchronization. Писать этот инфраструктурный слой с нуля не даёт продуктового преимущества и увеличивает объём кода для агентов.

## Решение

Использовать **Colyseus** как multiplayer/session/networking layer.

Colyseus отвечает за:

- create/join room;
- WebSocket transport;
- player sessions;
- reconnect;
- room lifecycle;
- первую реализацию state replication;
- возможный будущий lobby/matchmaking layer.

Colyseus **не является simulation engine** и не содержит самостоятельных игровых правил.

```text
Colyseus Room
   ↓ commands / session lifecycle
SimulationHost
   ↓
Simulation World
   ↓
ReplicationAdapter
   ↓
Colyseus Network State
```

## Последствия

Плюсы:

- меньше собственного networking boilerplate;
- готовая room/session abstraction;
- reconnect и state synchronization доступны на foundation-этапе;
- хорошо сочетается с TypeScript/Node.js.

Минусы:

- появляется framework dependency в server/network layer;
- Schema replication может потребовать замены/оптимизации при большом числе entities;
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
- public game commands описываются в `packages/protocol`, а не неявно внутри Room handlers.
