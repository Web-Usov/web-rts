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

### Bounded pathfinding work

Simulation использует deterministic lane budgets:

```text
commandBudget
activeTaskBudget
aiBudget

commandBudget + activeTaskBudget + aiBudget
<= maxPathQueriesPerTick
```

В #002 unused budget между lane не заимствуется.

Каждый законченный A*/breach-search invocation расходует одну query своего lane.

`commandBudget` обслуживает initial path/reachability work player commands. Обязательный invariant:

```text
MAX_MOVE_ENTITY_IDS <= commandBudget
```

Player command queue strict FIFO. Если head command помещается в fresh command budget, но не помещается в остаток текущего tick, command переносится целиком и later player commands в этом tick не обгоняют её.

`activeTaskBudget` обслуживает replans и path transitions уже принятых tasks. Если replan нужен, а budget исчерпан, entity **не входит в blocked/unknown next cell** и ждёт следующий tick.

`aiBudget` обслуживает autonomous PvE objective/breach/blocker planning. Player spam не может расходовать этот lane.

Multi-stage AI planning может переносить следующую целую query между ticks, но partial A* open/closed state не сохраняется.

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
- maximum accepted group MOVE fits within a fresh command lane budget;
- entity, ожидающая replan budget, не проходит в invalidated blocked cell.
