# ADR-007: replication boundary + visibility

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

Authoritative simulation содержит больше данных, чем должен видеть конкретный client. Особенно это важно для fog of war, hidden enemy state и будущих оптимизаций network payload.

Если network state сделать тем же объектом, что simulation state, transport/framework concerns быстро проникнут в game rules, а безопасная per-player visibility станет сложной.

## Решение

Разделить:

```text
Simulation State
      ↓
ReplicationAdapter
      ↓
Player/Team Network View
      ↓
Colyseus replication/messages
      ↓
ClientGameState
```

Simulation остаётся полной authoritative моделью.

`ReplicationAdapter` отвечает за:

- projection simulation state в network state;
- выбор полей, нужных client;
- visibility filtering;
- преобразование internal structures в transport-friendly representation;
- возможность позднее изменить replication strategy без изменения game rules.

Fog of war и information visibility являются **server-owned gameplay rules**. Hidden enemy entities не должны просто отправляться client и скрываться renderer'ом.

Persistent state передаётся через state replication; одноразовые notifications/VFX hints/command rejection могут передаваться events/messages.

## Последствия

Плюсы:

- simulation не зависит от Colyseus Schema;
- скрытая информация не утечёт client по умолчанию;
- можно отдельно оптимизировать payload/patch rate;
- можно заменить Colyseus state replication на другой serialization layer без переписывания simulation.

Минусы:

- нужно поддерживать projection между simulation и network state;
- per-player/team filtering имеет CPU/serialization cost;
- возможны bugs рассинхронизации projection, поэтому нужны integration tests.

## Альтернативы

### Реплицировать полный simulation state

Отклонено из-за утечки hidden information, лишнего network traffic и сильной связанности.

### Client-side fog only

Отклонено как небезопасная модель для PvP: скрытые enemy data всё равно были бы доступны client.

### Colyseus Schema как canonical world model

Отклонено: networking framework не должен определять внутреннюю структуру game simulation.

## Инварианты

- simulation state и replicated state — разные модели;
- server определяет player/team visibility;
- client не получает gameplay-sensitive hidden state без необходимости;
- replication frequency может меняться независимо от simulation tick;
- изменение transport/serialization не должно требовать изменения core gameplay rules.
