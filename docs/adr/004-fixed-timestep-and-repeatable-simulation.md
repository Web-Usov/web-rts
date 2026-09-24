# ADR-004: fixed timestep + repeatable simulation

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

RTS simulation должна одинаково работать на сервере, в Solo WebWorker, scenario tests и headless tools. Игровая логика не должна зависеть от FPS, wall-clock времени или `Math.random()`.

## Решение

Использовать **fixed timestep**. Начальное значение:

```text
10 ticks/sec
100 ms per tick
```

Tick rate хранится в config и может быть изменён после profiling/gameplay tests.

Внутри simulation запрещено напрямую использовать:

- `Date.now()`;
- `performance.now()`;
- `setTimeout()` для игровых правил;
- `Math.random()`.

Randomness идёт через seeded RNG abstraction. Commands применяются в явном порядке на границе tick.

Нам не требуется cross-platform deterministic lockstep. Цель — repeatability в одинаковом runtime/version для tests, debugging и будущих replay tools.

## Последствия

Плюсы:

- simulation не зависит от rendering FPS;
- проще воспроизводить bugs;
- scenario tests становятся стабильными;
- одинаковая модель подходит server и WebWorker;
- можно контролировать CPU budget систем на tick.

Минусы:

- 10 Hz требует client interpolation для плавного presentation;
- timers должны выражаться через ticks/game time;
- floating-point simulation не гарантирует bit-perfect determinism между разными runtime/platform versions.

## Альтернативы

### Variable delta time

Отклонено как основа gameplay simulation из-за сложности воспроизводимости и зависимости поведения от scheduling/load.

### Lockstep + fixed-point

Не нужен для authoritative server architecture и создаёт лишнюю сложность.

## Инварианты

- renderer loop и simulation loop независимы;
- game rules не читают wall clock;
- randomness injectable/seeded;
- tick rate не зашивается magic number по systems;
- изменение базового tick rate требует profiling/gameplay evidence, но не переписывания model.
