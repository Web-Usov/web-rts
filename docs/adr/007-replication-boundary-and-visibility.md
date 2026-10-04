# ADR-007: replication boundary + visibility

Статус: **Accepted**  
Дата: **2026-09-24**  
Уточнение стратегии: **2026-10-04**

## Контекст

Authoritative simulation содержит больше данных, чем должен видеть конкретный client. Особенно это важно для fog of war, hidden enemy state и будущих network optimizations.

Foundation реализовал transport-neutral snapshot + `GameStateView` messages, а не Colyseus Schema как canonical replicated world. Audit #53 показал, что Technical Vision всё ещё описывал старое предположение про Schema.

## Решение

Сохранить жёсткую boundary:

```text
Simulation / MatchRuntime
      ↓
transport-neutral MatchSnapshot
      ↓
recipient projection
      ↓
GameStateView
      ↓
transport message
      ↓
ClientGameState
```

Simulation остаётся полной authoritative моделью и не зависит от protocol/Colyseus.

Для текущего gameplay stage используется:

- один MatchSnapshot на simulation tick;
- per-recipient projection поверх этого snapshot;
- полный `GameStateView` message как baseline;
- one-shot events/messages для `COMMAND_REJECTED`, `ACTION_FAILED`, transient notifications/VFX hints.

Colyseus Schema, delta replication, dirty masks, binary serialization и отдельная patch frequency остаются допустимыми будущими optimizations после profiling. Они не должны менять gameplay rules или simulation structures.

Fog of war/information visibility остаются **server-owned gameplay policy**. Hidden state не отправляется client только для renderer-side hiding.

## Последствия

Плюсы:

- simulation не зависит от Colyseus Schema или wire DTO;
- Local и Remote используют одинаковую projection semantics;
- один snapshot на tick избегает повторного обхода World для каждого recipient;
- reconnect восстанавливается fresh persistent snapshot;
- serialization strategy можно менять независимо.

Минусы:

- full snapshots могут стать network bottleneck при росте entity count;
- projection/filtering имеет CPU/serialization cost;
- нужны parity/integration tests.

Если profiling покажет bottleneck, следующий шаг — измеряемая optimization/ADR update, а не перенос protocol concerns в simulation.

## Альтернативы

### Replicate full simulation state

Отклонено из-за утечки hidden data и связности.

### Client-side fog only

Отклонено как небезопасная PvP model.

### Colyseus Schema as canonical world model

Отклонено: networking framework не определяет simulation structure.

### Обязательный Colyseus Schema transport прямо сейчас

Не выбран. Foundation full-view messages достаточны для текущего масштаба; Schema/delta path остаётся optimization option.

## Инварианты

- simulation state и replicated state — разные модели;
- MatchSnapshot transport-neutral;
- per-recipient visibility authoritative;
- one snapshot per tick может обслуживать несколько projections;
- critical persistent gameplay state находится в state view, а не только events;
- replication frequency/serialization могут меняться независимо от simulation tick;
- transport optimization не требует изменения core gameplay rules.
