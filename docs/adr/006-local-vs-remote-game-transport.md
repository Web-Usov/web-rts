# ADR-006: local vs remote GameTransport

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

Web client должен одинаково работать в Solo и Multiplayer. Если UI/presentation напрямую завязать на Colyseus, Solo потребует отдельного code path или запуск полноценного server process даже для локальной игры.

## Решение

Ввести клиентскую boundary `GameTransport`.

Примерный контракт:

```ts
interface GameTransport {
  connect(options: ConnectOptions): Promise<void>;
  sendCommand(command: GameCommand): void;
  subscribeState(listener: StateListener): Unsubscribe;
  subscribeEvent(listener: EventListener): Unsubscribe;
  disconnect(): Promise<void>;
}
```

Реализации:

```text
RemoteGameTransport -> Colyseus SDK -> authoritative server
LocalGameTransport  -> WebWorker -> shared simulation
```

Presentation и UI работают через этот контракт и не должны знать, где физически исполняется simulation.

## Последствия

Плюсы:

- единый client flow для Solo/Coop/PvP;
- Solo не требует удалённого server process;
- network layer заменяем;
- client presentation легче тестировать через fake transport;
- WebWorker изолирует simulation/AI/pathfinding от main render thread.

Минусы:

- local и remote implementations должны поддерживать одинаковую семантику state/events;
- появляется дополнительный abstraction layer;
- WebWorker messaging имеет serialization/transfer overhead, который нужно измерять.

## Альтернативы

### Отдельный Solo client path

Отклонено из-за дублирования integration logic и риска расхождения поведения.

### Всегда запускать локальный Node server

Технически возможно, но неудобно для обычного browser Solo и не работает как чистое web-приложение без внешнего runtime.

### Simulation на browser main thread

Допустимо только для раннего prototype, но целевой Solo runtime использует Worker, чтобы тяжёлая simulation не блокировала rendering/input.

## Инварианты

- presentation зависит от `GameTransport`, а не напрямую от Colyseus Room;
- local и remote transports используют общий protocol/state semantics;
- игровые правила не дублируются в client;
- transport boundary должна существовать до полноценной Solo gameplay реализации.
