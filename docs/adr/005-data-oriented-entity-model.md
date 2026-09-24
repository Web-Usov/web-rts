# ADR-005: data-oriented entity model

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

RTS должна обрабатывать множество однотипных runtime entities: units, buildings, resources, projectiles, objectives. Глубокая object-oriented hierarchy усложнит композицию поведения и оптимизацию hot paths.

## Решение

Использовать **data-oriented, system-driven entity model** без обязательного стороннего ECS framework на foundation-этапе.

Базовая форма:

```text
World
 ├─ entity registry
 ├─ component stores
 ├─ systems
 ├─ command queue
 ├─ event queue
 ├─ RNG
 └─ tick counter
```

Runtime entity IDs — компактные numeric IDs, совместимые с `uint32`-подходом.

Компоненты содержат данные, системы — поведение.

Примеры компонентов:

- Position;
- Health;
- Movement;
- Combat;
- Owner;
- Controller;
- Building;
- Objective.

Не строим hierarchy вида `Entity -> Unit -> Human -> Soldier -> Archer`.

## Последствия

Плюсы:

- удобная композиция поведения;
- проще работать с массовыми entities;
- легче профилировать и оптимизировать stores/systems;
- game rules остаются независимы от renderer classes.

Минусы:

- потребуется собственная дисциплина для lifecycle компонентов и queries;
- без готового ECS часть plumbing пишется самостоятельно;
- при росте нагрузки может потребоваться миграция stores на более специализированную ECS/data layout.

## Альтернативы

### Классическая OOP hierarchy

Отклонена как основная модель для runtime entities из-за жёсткой связанности поведения и данных.

### Готовый ECS framework с первого дня

Не выбран: foundation пока не доказал, что дополнительный framework нужен. Его можно принять отдельным ADR после benchmarks.

## Инварианты

- composition предпочтительнее inheritance;
- components не зависят от presentation/network frameworks;
- systems работают через world/component data;
- UUID не используется как основной hot-path ID тысяч runtime entities;
- package boundaries не дробятся под каждый component/system без реальной необходимости.
