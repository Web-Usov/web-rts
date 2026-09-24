# ADR-001: authoritative server + shared simulation

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

Web RTS должна поддерживать Solo, Coop и PvP/PvPvE, не превращаясь в три разные реализации игровых правил. Для multiplayer нужен единый источник истины, иначе быстро появляются расхождения состояния, читинг и сложные случаи reconnect.

## Решение

Использовать **authoritative game server** для multiplayer и одну общую `simulation` для всех режимов.

```text
Solo:
Browser -> LocalGameTransport -> Simulation

Multiplayer:
Browser -> RemoteGameTransport -> Game Server -> Simulation
```

Клиент отправляет только намерения/commands. Итоговое состояние матча определяет simulation на authoritative стороне.

`simulation` не зависит от React, Babylon.js, Colyseus, DOM, WebSocket, базы данных или конкретного server framework.

## Последствия

Плюсы:

- одинаковые игровые правила во всех режимах;
- проще тестировать gameplay без browser/network;
- меньше возможностей для client-side cheating;
- multiplayer можно перенести с LAN на VPS без переписывания game rules;
- reconnect и передача контроля решаются на серверной стороне.

Минусы:

- multiplayer требует запущенного server process;
- server несёт CPU-нагрузку simulation;
- необходимо проектировать state replication между authoritative state и client view.

## Альтернативы

### Client-owned state

Отклонено: подходит для простого прототипа, но плохо масштабируется в authoritative multiplayer.

### P2P / host-authoritative

Не используется в foundation из-за NAT/STUN/TURN, host loss, host migration и более сложной trust model.

### Отдельные Solo и multiplayer simulations

Отклонено из-за дублирования правил и риска расхождения поведения.

## Инварианты

- multiplayer server является authority;
- клиент не сообщает итоговые HP/resources/position как истину;
- Solo и multiplayer используют одни game rules;
- `simulation` остаётся framework-agnostic.
