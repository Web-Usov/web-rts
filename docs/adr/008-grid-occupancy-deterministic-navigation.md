# ADR-008: grid, occupancy and deterministic navigation

Статус: **Accepted**  
Дата: **2026-10-04**

## Контекст

Gameplay Spec #002 добавляет construction, Walls, resource interactions и objective-driven PvE. Foundation хранит continuous `Position {x,y}` и прямолинейный Movement, но не имеет navigation/build grid.

Нужно получить deterministic pathfinding и spatial occupancy, не превращая всю simulation в tile-locked game и не вводя crowd/RVO complexity преждевременно.

## Решение

### Continuous world + discrete grid

Entity position/movement/ranges остаются continuous world-space.

Grid — отдельный simulation layer для walkability/buildability, solid footprint occupancy, navigation topology и deterministic construction placement.

Для #002: **1 navigation cell = 1 simulation world unit**. Map bounds выводятся из grid и используют half-open intervals.

`game-data` хранит declarative MapDefinition. Runtime grid/occupancy/navigation принадлежат `simulation`.

### Generic solid footprint

Grid occupancy не building-specific. Solid entity имеет footprint/capabilities вроде `blocksMovement` / `blocksBuilding`.

Construction Site резервирует footprint и становится blocker в tick принятия BUILD.

Units не являются A* blockers в #002 и не резервируют cells. BUILD при этом нельзя принять поверх текущей unit cell.

### Navigation

MOVE остаётся world-space intent.

4-neighbor A*:

- uniform edge cost 1;
- Manhattan heuristic;
- stable row-major cell id;
- deterministic tie-break: f → h → cell id;
- fixed neighbour order.

Path использует cell centers как intermediate waypoints, но exact valid MOVE target остаётся final world destination.

Interactions с occupied targets используют deterministic set of approach goal cells.

### Replan / topology

Current path проверяется лениво перед следующим blocked waypoint. Solid add/remove увеличивает monotonic `topologyRevision`.

### Breach-aware PvE planning

Если normal route к Sacred Site approach cells отсутствует, PvE запускает deterministic breach-aware search.

Hostile breachable footprints виртуально traversable только в planning query. Route минимизирует:

```text
(breachCount by entity, pathLength, deterministic tie-break)
```

AI выбирает первый breachable entity на route, подходит обычным A* к attack cells, держит target до invalidation/destruction и затем снова пробует normal route.

Static/non-breachable terrain не разрушается. Если нет normal или breach route, enemy STALLED и retry делает после topology change.

### Bounded pathfinding work and fair command scheduling

Simulation использует deterministic bounded scheduler:

```text
maxPendingCommandsPerPlayer
maxCommandsPerTick

commandBudget
activeTaskBudget
aiBudget

commandBudget + activeTaskBudget + aiBudget
<= maxPathQueriesPerTick
```

В #002 unused path budget между lane не заимствуется.

#### Command ingress / fairness

MatchRuntime хранит отдельную strict-FIFO queue на каждого player.

Если queue достигла `maxPendingCommandsPerPlayer`, новая command не enqueue'ится и получает `COMMAND_REJECTED(queue_full)`.

Remote transport rate limit дополняет, но не заменяет shared runtime queue cap.

Между player queues используется deterministic round-robin по stable ascending `playerId` с persistent cursor.

За round scheduler рассматривает максимум одну head command каждого player. Later command этого player не может обогнать head. Scheduler прекращает работу при `maxCommandsPerTick`, исчерпании schedulable `commandBudget` или отсутствии schedulable heads.

Start cursor следующего tick сдвигается, чтобы scarce budget не давал постоянный приоритет одному player.

Deterministic path-cost reservation:

```text
MOVE(entityIds[]) → entityIds.length
GATHER            → 1
BUILD NEW         → 1
BUILD EXISTING    → 1
GARRISON          → 1
UNGARRISON        → 0
```

Reserved cost не возвращается в текущем tick при раннем semantic rejection.

Обязательный invariant:

```text
MAX_MOVE_ENTITY_IDS <= commandBudget
```

Если head одного player не помещается в остаток текущего command budget, она остаётся head; scheduler может обслужить других players, чьи head commands помещаются. Raw cross-player packet arrival order не является authoritative gameplay order.

#### Active-task lane

`activeTaskBudget` обслуживает replans/path transitions уже accepted tasks.

Requests сортируются по ascending `entityId`; максимум одна active-task path query на entity за tick.

Если replan нужен, но budget недоступен, entity не входит в blocked/unknown cell и ждёт следующий tick.

#### AI lane

`aiBudget` обслуживает autonomous PvE objective/breach/blocker planning.

AI entities сортируются по ascending `entityId`; максимум одна expensive path query на AI entity за tick.

Multi-stage planner хранит только deterministic high-level phase; следующая query участвует в обычном entityId-order следующего tick. Partial A* state между ticks не сохраняется.

## Последствия

Плюсы:

- grid не ломает continuous RTS movement;
- Walls действительно меняют routes;
- construction/resource/combat/garrison используют один approach-goal mechanism;
- deterministic outputs подходят scenario tests;
- units не создают deadlock/reservation complexity.

Минусы:

- units могут визуально overlap;
- 4-neighbor paths могут выглядеть угловато;
- per-query A* позже может потребовать optimization.

Flow fields/navmesh/RVO/resumable A* добавляются только после measurement.

## Инварианты

- presentation coordinates не являются simulation topology;
- static map data declarative, runtime topology в simulation;
- moving units не являются path blockers #002;
- accepted construction blocks immediately;
- no gameplay RNG in A*;
- same topology/start/goal → same path;
- pathfinding work per tick bounded deterministically;
- player command spam не может starvation active-task replans или PvE AI;
- per-player pending command memory bounded;
- один player не может неограниченно задерживать command ingress остальных;
- cross-player command ordering deterministic и fair;
- maximum accepted group MOVE fits within a fresh command lane budget;
- active-task/AI requests имеют stable ascending entityId order и max one query/entity/tick;
- entity, ожидающая replan budget, не проходит в invalidated blocked cell.
