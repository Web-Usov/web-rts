# Gameplay Spec #002 — First Economy & Defense Vertical Slice

Статус: **ACCEPTED — implementation in progress**  
Дата: **2026-10-04**  
Проект: **Web RTS**  
Tracking issue: **#50**

> Архитектурный проход по #002 завершён и reconciled с merged Art Direction (#48/#49, PR #51)
> и техническим аудитом #53. PR #52 уже merged в `main`; implementation идёт через epic #50 и
> reviewable child issues. Логические stages этой Spec сохраняются, а GitHub decomposition может
> делить крупный stage на несколько PR без изменения архитектурного contract.

## 1. Цель

После Foundation Spec #001 перейти от технического vertical slice к первому короткому настоящему RTS-loop.

Целевой пользовательский цикл #002:

```text
добыча Wood
→ строительство обороны
→ подготовка позиции
→ предупреждение о волне
→ PvE-атака
→ оборона Sacred Site
```

Ориентир для ручной сессии — примерно **5–10 минут**.

Одинаковые gameplay rules обязаны работать через оба execution path:

```text
LocalGameTransport → WebWorker → shared simulation
RemoteGameTransport → authoritative server → shared simulation
```

Отдельных Solo-версий economy, construction, combat, AI или wave rules быть не должно.

## 2. Source of truth

Реализация должна соответствовать:

- `docs/game-vision.md`;
- `docs/art-direction.md` — visual direction/readability target; он не расширяет gameplay scope сам по себе;
- `docs/technical-vision.md`;
- Foundation Spec #001;
- ADR-001…007;
- ADR-008 — grid, occupancy and deterministic navigation;
- ADR-009 — shared MatchRuntime and protocol/simulation adapter boundary.

Технический аудит #53 является review input, а не отдельным уровнем source of truth. Его подтверждённые H1–H4 и релевантные M1–M6 встроены в эту spec/ADR/implementation graph.

Art Direction задаёт долгосрочный visual target. Наличие на concept references дорог, полей, ворот, quarry, outposts, weather, большого числа props или иных объектов не добавляет их в #002 автоматически.

Если implementation требует изменить существующий архитектурный инвариант, работа сначала возвращается на уровень spec/ADR.

## 3. Player-visible scenario

Матч начинается минимум с:

```text
1 Sacred Site
1 Town Hall
1 Worker
1 Soldier
несколько Wood Resource Nodes
```

Игрок может:

1. назначить Worker на Wood Resource Node;
2. дождаться цикла gather → carry → deposit;
3. накопить Wood;
4. построить Wall и Tower;
5. оставить Soldier мобильным либо разместить его в Tower;
6. получить предупреждение о приближающейся PvE wave;
7. встретить basic melee enemies;
8. использовать Walls для изменения маршрута врагов;
9. защищать Sacred Site Soldier и Tower;
10. пережить волну и получить `WAVE_CLEARED`, либо проиграть при уничтожении Sacred Site.

## 4. Scope

В #002 входят:

- одна фиксированная handcrafted map;
- logical navigation/build grid;
- walkability/buildability;
- building footprint и occupancy;
- deterministic 4-neighbor A*;
- path-following movement;
- один ресурс — `WOOD`;
- конечные Resource Nodes;
- Worker gathering / carry / deposit;
- player-owned resource stockpile;
- стартовый Town Hall;
- Wall;
- Tower;
- construction lifecycle;
- Health / damage / death;
- минимальная team/hostility model;
- один стартовый melee Soldier;
- Soldier auto-aggro + limited chase;
- automatic Tower combat;
- Tower garrison;
- один basic melee PvE enemy archetype;
- простой objective-driven enemy AI;
- одна deterministic PvE wave;
- wave lifecycle `PREPARING → WARNING → ACTIVE → CLEARED`;
- Sacred Site HP и defeat;
- необходимые protocol/replication/UI изменения;
- representative Babylon.js visual target после gameplay integration: Wall/Tower/Sacred Site/human unit/environment, normal + strategic zoom;
- Local и Remote verification.

## 5. Non-goals

Не входят:

- дополнительные ресурсы;
- Food / Stone / Gold;
- второй Town Hall;
- rebuild Town Hall;
- Barracks;
- производство юнитов;
- population cap;
- upgrades / tech tree;
- fog of war;
- territory;
- PvP;
- resource/unit/building transfer;
- несколько enemy archetypes;
- сложный squad AI;
- formations;
- flow fields;
- navmesh;
- RVO/crowd simulation;
- ranged Soldier;
- projectile entities;
- armor/resistance/critical hits/status effects;
- repair;
- construction cancel/refund;
- save/load;
- procedural maps;
- victory condition;
- production-ready graphics/audio и массовое производство финальных assets;
- финальная visual identity PvE;
- дороги/поля/ворота/quarry/outposts только потому, что они присутствуют на concept art;
- weather/day-night implementation;
- обязательный camera redesign/rotation;
- persistent gameplay ruins/loot без отдельной gameplay spec.

## 6. Архитектурные инварианты

Обязательны:

- multiplayer server authoritative;
- shared simulation для Local и Remote;
- fixed timestep;
- seeded deterministic gameplay;
- renderer не является gameplay state;
- replication не является simulation state;
- Colyseus скрыт за GameTransport;
- React не управляет entity transforms per-frame;
- simulation не импортирует DOM, Babylon.js, React или Colyseus;
- simulation не читает wall-clock;
- gameplay не использует `Math.random()`;
- public gameplay semantics не зависят от transport mode.

## 7. Spatial/Grid contract — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

### 7.1 Continuous world + discrete grid

Web RTS не становится клеточной simulation.

Gameplay position остаётся непрерывной:

```text
Position { x, y }
movement speed
attack range
click target
```

Grid является отдельным дискретным spatial layer для:

- navigation;
- buildability;
- solid footprint occupancy;
- construction placement.

Инвариант:

```text
grid = где можно идти/строить
world coordinates = где entity фактически находится
```

Babylon boundary остаётся прежней: simulation ground `(x, y)` отображается в Babylon ground `(x, z)`.

### 7.2 Spatial scale and map bounds

Для #002:

```text
1 navigation cell = 1 simulation world unit
```

Это game-wide spatial scale, а не индивидуальный tuning каждой карты.

Declarative map definition должна задавать минимум:

```text
originX
originY
widthCells
heightCells
static walkability/buildability
spawn regions
starting placements
resource placements
```

Gameplay bounds выводятся из grid и используют half-open semantics:

```text
[minX, maxX)
[minY, maxY)
```

Преобразование должно быть deterministic:

```text
worldToCell:
floor((world - origin) / cellSize)

cellToWorldCenter:
origin + (cell + 0.5) * cellSize
```

Presentation не должна владеть отдельным hardcoded gameplay map extent. Размер карты имеет один source of truth через map definition.

### 7.3 Package boundary

`@web-rts/game-data` хранит декларативные map definitions и spatial constants.

`@web-rts/simulation`:

- создаёт runtime grid;
- применяет occupancy;
- валидирует gameplay placement;
- выполняет navigation/pathfinding;
- меняет occupancy в результате gameplay.

A*, occupancy mutation и placement rules не должны жить в `game-data`.

### 7.4 Generic solid occupancy

Runtime grid не должен иметь building-specific occupancy.

Cell концептуально содержит:

```text
staticWalkable
staticBuildable
solidOccupantEntityId | null
```

Entity, физически занимающая пространство, имеет generic spatial footprint concept:

```text
SpatialFootprint
├─ anchorCell
├─ width
├─ height
├─ blocksMovement
└─ blocksBuilding
```

Конкретная TypeScript representation определяется implementation issue, но semantics generic.

Одна модель должна поддерживать минимум:

- Wall;
- Tower;
- Town Hall;
- Sacred Site;
- Resource Node;
- Construction Site.

Не допускается spatial logic вида `if building ... else if resource ...` как основной архитектурный механизм.

### 7.5 Units are not navigation blockers in #002

Units не входят в A* occupancy и не резервируют cells.

Следствия #002:

- units могут находиться в одной navigation cell;
- units могут визуально пересекаться;
- unit-vs-unit collision avoidance отсутствует;
- reservation/deadlock/yielding/RVO/flow-field находятся вне scope.

Это сознательное ограничение vertical slice.

При BUILD текущие unit positions всё равно участвуют в placement validation: новый solid footprint нельзя разместить поверх cell, в которой сейчас находится unit.

### 7.6 Construction occupancy timing

После принятия валидной BUILD-команды:

```text
resources spent
→ construction entity created
→ footprint registered as solid
→ navigation sees new blocker
```

Construction Site блокирует movement/building **с того же simulation tick**, не после completion.

System-order invariant:

```text
tick
├─ apply commands / occupancy changes
├─ validate or replan navigation
├─ continuous movement
└─ remaining gameplay systems
```

Если новый footprint блокирует следующий waypoint движущегося entity, path должен быть пересчитан до movement этого tick.

## 8. Navigation — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

### 8.1 MOVE remains world-space intent

Public MOVE остаётся world-space command:

```text
MOVE target = { x, y }
```

Client не отправляет navigation cell как authoritative intent.

Simulation:

```text
world target
→ worldToCell
→ navigation
→ path waypoints
→ continuous movement
```

Это сохраняет protocol независимым от navigation resolution.

### 8.2 Path execution

A* строит последовательность cells.

Movement идёт через центры промежуточных path cells, но финальная точка остаётся исходной точной world-space целью MOVE.

Пример:

```text
click exact world point
→ A* cell path
→ intermediate cell centers
→ exact clicked destination
```

Текущий continuous movement layer не должен заменяться grid teleport/snapping.

Архитектурное разделение:

```text
Move intent / destination
        ↓
Navigation system
        ↓
NavigationPath
        ↓
next world-space waypoint
        ↓
continuous movement system
```

### 8.3 Blocked direct MOVE target

Если world-space MOVE target попадает в:

- solid footprint;
- non-walkable cell;
- другую недопустимую navigation cell;

обычный MOVE отклоняется явной gameplay reason вроде `blocked_target`.

Simulation не ищет магически ближайшую свободную клетку для обычного MOVE.

Semantic interactions используют отдельные intents:

- `GATHER` для Resource Node;
- `GARRISON` для Tower;
- `BUILD` для construction.

### 8.4 Goal sets / approach cells

Navigation API не должно ограничиваться моделью `findPath(start, oneGoalCell)`.

Resource Nodes, Buildings, combat targets и garrison targets сами занимают blocked footprint.

Pathfinding должен поддерживать **набор допустимых approach goal cells** вокруг target footprint.

Концептуально:

```text
target footprint
████

valid approach cells
····
·██·
·██·
····
```

Navigation выбирает deterministic reachable goal из допустимого goal set.

Этот contract должен использоваться Worker gathering/construction, melee engagement, blocker attack и garrison approach без отдельных pathfinding special cases.

### 8.5 Deterministic A*

Для #002 фиксируются:

| Свойство | Решение |
|---|---|
| Graph | 4-neighbor |
| Edge cost | 1 |
| Heuristic | Manhattan |
| RNG | отсутствует |
| Cell identity | stable row-major index |
| Tie-break | `f`, затем `h`, затем stable cell id |
| Neighbor enumeration | fixed order |
| Blockers | static terrain + solid footprint occupancy |
| Units | игнорируются |
| No path | explicit failure |

Одинаковые map/occupancy/start/goal должны всегда давать один и тот же выбранный path в одинаковом runtime/version.

### 8.6 Lazy path invalidation / replan

Постройка нового Wall не должна глобально пересчитывать paths всех moving entities.

Перед использованием следующего navigation waypoint:

```text
next path cell still traversable?
├─ yes → continue
└─ no  → replan
```

Это базовая invalidation policy #002.

### 8.7 PvE blocker selection / breach-aware planning — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

Обычный navigation сначала всегда пытается построить normal path до approach cells Sacred Site.

```text
normal A*
↓
path found?
├─ yes → use normal path
└─ no  → breach-aware planning
```

Breach-aware planning использует тот же grid, но для planning query может виртуально проходить через
некоторые hostile destructible solid footprints. Runtime occupancy при этом не меняется и blocker не становится
реально walkable до разрушения.

#### Breachable vs non-breachable blockers

Spatial/gameplay data должно позволять отличить solid footprint, которое PvE может разрушить ради прохода.

Для #002:

```text
Wall              breachable
Tower             breachable
Town Hall         breachable
Construction Site breachable

Resource Node     non-breachable
static rock       non-breachable
water/terrain     non-breachable
```

Sacred Site является objective target; path строится к его approach cells, поэтому его footprint не используется как
промежуточный breach target.

Архитектура не должна зашивать список через `if entity is Wall/Tower`; breachability является gameplay capability/data.

#### Route optimization

Breach-aware route оценивается лексикографически:

```text
(breachCount, pathLength, deterministicTieBreak)
```

Приоритет:

1. минимальное число разрушенных solid entities;
2. среди таких маршрутов — минимальная длина пути;
3. затем deterministic tie-break.

Не используется произвольный magic cost вроде `wallCost = 100`.

Для multi-cell footprint breach считается **по entity**, а не по количеству её cells:

```text
free → same blocker entity = +1 breach
inside same blocker footprint → +0
leave blocker footprint → +0
enter another blocker entity → +1
```

Поэтому разрушение одного Town Hall остаётся одним breach, даже если footprint занимает несколько cells.

#### Target selection from breach route

После выбора breach-aware route PvE AI берёт **первый breachable occupant entity** вдоль этого route.

Enemy не пытается войти в blocked footprint. Для атаки blocker используются обычные approach goal cells:

```text
selected blocker
→ compute valid attack approach cells
→ normal A* to approach cell
→ melee attack blocker
```

Таким образом navigation выбирает route/blocker, combat наносит damage, а AI связывает эти systems.

#### Blocker target stickiness

После выбора blocker target enemy сохраняет его, пока target:

- существует;
- остаётся hostile/breachable;
- доступен для атаки.

Target не пересчитывается каждый tick.

Если blocker уничтожен этим или другим unit:

```text
blocker invalid
→ retry normal path to Sacred Site
→ if still no path, run breach-aware planning again
```

Полный список будущих breaches заранее не кэшируется, потому что topology может измениться во время боя.

#### Multiple enemies

В #002 enemies принимают blocker decision независимо.

Несколько enemies могут выбрать один и тот же Wall/Building и сфокусировать его.
Распределение attackers, squad coordination и anti-overkill находятся вне scope.

#### Impossible route and topology revision

Handcrafted #002 map обязана удовлетворять invariant:

> Без player-created breachable structures каждый PvE spawn region имеет normal navigation route к Sacred Site.

Это проверяется map/scenario test.

Если runtime state всё же не имеет ни normal route, ни breach-aware route:

```text
enemy → STALLED/BLOCKED
```

Телепортация, проход сквозь terrain или destruction non-breachable terrain запрещены.

Runtime spatial topology должна иметь monotonic `topologyRevision`, которая меняется при добавлении/удалении
solid footprint. Enemy после полного planning failure не повторяет дорогой поиск каждый tick; retry допускается после
изменения topology revision (либо другого явного invalidation event).

#### Responsibility boundary

```text
Navigation
├─ normal path query
└─ breach-aware route query
        ↓
      blocker entity
        ↓
PvE AI selects/holds gameplay target
        ↓
Combat destroys blocker
        ↓
Navigation reevaluates objective route
```

Navigation не наносит damage и не принимает combat decisions.
Combat не знает, почему target был выбран.
PvE AI не реализует собственную геометрию стен поверх navigation layer.

### 8.8 Deterministic pathfinding work budget — APPROVED

Pathfinding work per tick bounded и deterministic. Ни player spam, ни один конкретный player не должны starvation'ить active tasks, PvE AI или commands других players.

Для #002 MatchRuntime использует:

```text
RuntimeConfig:
  maxPendingCommandsPerPlayer
  maxCommandsPerTick

SimulationConfig.pathQueriesPerTick:
  commandBudget
  activeTaskBudget
  aiBudget

commandBudget + activeTaskBudget + aiBudget
<= maxPathQueriesPerTick
```

В #002 unused path budget между lane не заимствуется.

Каждый законченный A* / breach-search invocation расходует одну query соответствующего lane.

#### Per-player command admission

MatchRuntime хранит **отдельную FIFO queue на каждого player**.

Если trusted command поступает, когда:

```text
pendingCommands(playerId) >= maxPendingCommandsPerPlayer
```

command **не enqueue'ится** и получает transport-neutral rejection:

```text
COMMAND_REJECTED(queue_full)
```

Это admission/backpressure rejection, а не gameplay semantic validation: world state для неё не читается.

Таким образом память command ingress bounded одинаково для Local и Remote. Remote Room rate limit остаётся дополнительным transport-level guard и не заменяет runtime queue cap.

#### Fair command scheduling

Внутри каждой player queue сохраняется strict FIFO.

Между players используется deterministic round-robin по stable ascending `playerId` с persistent `nextCommandPlayerCursor`.

Scheduler работает rounds:

1. начинает round с cursor;
2. посещает каждого participant player максимум один раз за round;
3. рассматривает **только head command** его queue;
4. later command того же player никогда не обгоняет head;
5. после полного round следующий round снова идёт cyclic order, пока не исчерпан `maxCommandsPerTick`, `commandBudget` или не осталось schedulable heads;
6. start cursor следующего tick сдвигается на следующего player, чтобы scarce budget не давал постоянный first-player advantage.

Количество processed commands за tick всегда ограничено `maxCommandsPerTick`.

Для scheduling каждая command имеет deterministic upper-bound path cost:

```text
MOVE(entityIds[]) → entityIds.length
GATHER            → 1
BUILD NEW         → 1
BUILD EXISTING    → 1
GARRISON          → 1
UNGARRISON        → 0
```

Scheduler **резервирует этот cost целиком** перед command application. Если semantic validation завершилась раньше и фактический A* не понадобился, зарезервированный cost в этом tick не возвращается. Это делает fairness/order независимыми от текущего gameplay state.

Cross-config invariant:

```text
MAX_MOVE_ENTITY_IDS <= commandBudget
```

Если head command конкретного player помещается в fresh `commandBudget`, но не помещается в остаток текущего tick, она остаётся head этой player queue. Scheduler **может продолжить обслуживание других players**, чьи head commands помещаются в остаток budget; внутри очереди заблокированного player обгона нет.

Raw network arrival order между разными players **не является authoritative gameplay order**. Для same-tick conflicts authoritative order задаёт deterministic fair scheduler.

#### Active-task lane

`activeTaskBudget` используется уже принятыми gameplay tasks:

- movement replan после topology change;
- Worker node → drop-off → node continuation;
- construction/garrison task replan;
- другие path transitions уже accepted task.

Entities, которым нужна path query, обрабатываются в **ascending entityId**.

Для одной entity допускается максимум **одна active-task path query за tick**. Active task state должна представлять максимум один pending navigation request на entity.

Если entity нуждается в новом path, но `activeTaskBudget` исчерпан:

> **entity не двигается в blocked/unknown next cell и ждёт следующий tick.**

Valid existing path может продолжать movement без новой query.

#### AI lane

`aiBudget` используется autonomous PvE planning:

- normal objective path;
- breach-aware search;
- path к выбранному blocker/attack approach;
- retry после topology invalidation.

AI entities обслуживаются в **ascending entityId**.

Одна AI entity может выполнить максимум **одну expensive path query за tick**.

Multi-stage planner хранит deterministic high-level phase:

```text
NORMAL_OBJECTIVE
BREACH_SEARCH
APPROACH_BLOCKER
```

Если для решения требуется следующая query, она участвует в обычном entityId-order следующего tick. Partial A* open/closed state между ticks в #002 не сохраняется.

Если `aiBudget` исчерпан, AI ждёт следующий tick; combat, уже не требующий новой path query, не обязан останавливаться.

Таким образом:

- player spam не может выбрать active-task/AI budget;
- один player не может бесконечно блокировать command ingress остальных;
- queue memory bounded;
- replan/AI ordering deterministic;
- один entity не может съесть весь lane budget серией sequential searches.

Resumable A*, worker-thread pathfinding, flow fields и dynamic borrowing между budget lanes вне #002.

## 9. Economy

В #002 существует только:

```text
WOOD
```

Однако resource model должна допускать будущие ResourceType без переписывания core economy.

Resource stockpile принадлежит игроку, а не зданию:

```text
PlayerEconomy
└── WOOD amount
```

Town Hall является physical drop-off.

## 10. Resource Nodes и Worker gathering

Wood Resource Node имеет:

```text
resourceType = WOOD
remaining > 0
```

Worker получает intent:

```text
GATHER(resourceNodeId)
```

После валидной команды цикл выполняется автоматически:

```text
path to node
→ gather
→ fill carry capacity
→ path to owned Town Hall
→ deposit
→ return to same node
→ repeat
```

`carryCapacity`, `gatherRate` и node capacity задаются через game-data.

### Depletion

Зафиксировано:

> **После истощения назначенного ResourceNode Worker не ищет новую точку автоматически.**

Если Worker несёт Wood, он сначала выполняет deposit. После этого становится `IDLE`.

Новая явная команда игрока заменяет текущую Worker task.

Per-entity queued/Shift-orders в #002 отсутствуют: новая явная Worker command заменяет текущую task. Runtime per-player ingress queues из §8.8 — отдельный transport/runtime scheduling mechanism и не являются gameplay Shift-order queue.

Если доступного owned drop-off нет **при применении GATHER**, command отклоняется с machine-readable reason `no_dropoff`.

Если drop-off существовал при старте task, но позже уничтожен/стал unavailable:

```text
current gather loop
→ ACTION_FAILED(no_dropoff)
→ Worker IDLE
```

Wood, уже находящийся в carry Worker, сохраняется у Worker и не создаётся/не исчезает автоматически. После появления нового valid drop-off/новой gameplay возможности игрок должен выдать новую явную command; бесконечный auto-search отсутствует.

## 11. Construction

Одна public command `BUILD` обслуживает создание новой стройки и продолжение уже существующей.

Conceptual intent:

```text
BUILD {
  builderEntityId

  target:
    | NEW {
        buildingTypeId
        anchorCell { x, y }
      }
    | EXISTING {
        constructionEntityId
      }
}
```

### BUILD NEW

Simulation валидирует минимум:

- Controller permission;
- builder capability;
- building definition;
- Wood availability;
- footprint/buildability/occupancy;
- valid build approach/reachability.

После принятия:

```text
Wood списывается
→ создаётся building entity
→ state = UNDER_CONSTRUCTION
→ footprint сразу занимает grid
→ Worker получает construction task
→ site сразу считается busy этим Worker
→ progress растёт по simulation ticks после достижения build range
→ state = COMPLETED
```

Spend + entity creation + occupancy registration + task assignment атомарны относительно command application.

### BUILD EXISTING

Используется, чтобы продолжить paused Construction Site.

В #002 construction access policy — **same Owner**:

```text
builder.Owner == constructionSite.Owner
```

Friendly/Team relationship недостаточно. Allied construction в Coop может быть разрешена отдельной будущей policy без изменения command shape.

Simulation валидирует минимум:

- Controller permission;
- builder capability;
- `constructionEntityId` существует;
- target остаётся `UNDER_CONSTRUCTION`;
- builder и site имеют одного Owner;
- site не занята другим active builder;
- Worker может добраться до valid build approach.

Successful `BUILD EXISTING`:

- **не списывает Wood повторно**;
- не создаёт новую entity;
- не меняет footprint;
- сохраняет существующий progress;
- сразу назначает Worker construction task;
- сразу резервирует site за этим Worker, включая время approach.

### Active builder semantics

Worker считается **active builder с момента успешного применения BUILD NEW/EXISTING**, а не только после входа в build range.

Canonical source busy-state — current Worker construction task:

```text
WorkerTask {
  type = BUILD
  constructionEntityId
}
```

Отдельный mutable `ConstructionSite.activeBuilderId` не является вторым authoritative source. Implementation может иметь derived/index cache, если он не меняет semantics.

В #002 одна Construction Site имеет максимум одного active Worker.

Если другой Worker пытается `BUILD EXISTING` для уже reserved site:

```text
COMMAND_REJECTED(construction_busy)
```

Если тот же Worker повторно посылает `BUILD EXISTING` на site, которую уже строит:

```text
COMMAND_REJECTED(already_building)
```

Reservation освобождается, когда:

- Worker получает MOVE/GATHER/другую несовместимую explicit task;
- Worker погибает/удаляется;
- construction task получает terminal `ACTION_FAILED`, например окончательный `path_blocked`;
- site уничтожена;
- site завершена.

Временное ожидание `activeTaskBudget` **не освобождает reservation**: Worker просто ждёт path query.

После release:

- construction entity остаётся, если не уничтожена;
- progress сохраняется;
- footprint сохраняется;
- site становится paused/free для нового `BUILD EXISTING`.

Недостроенное building имеет Health и может быть уничтожено.

Refund отсутствует.

## 12. Town Hall

В #002 существует **только стартовый Town Hall**.

Не поддерживаются:

- BUILD Town Hall;
- второй Town Hall;
- rebuild Town Hall.

Town Hall:

- player-owned;
- Wood drop-off;
- destructible;
- не является match objective.

Потеря Town Hall сама по себе не означает defeat.

## 13. Wall

Wall:

```text
building
1x1 footprint
Health
hard navigation obstacle
no attack
```

Wall должна реально влиять на enemy path.

Если Wall участвует в полной блокировке пути, PvE AI должен иметь возможность разрушить blocker и продолжить objective.

## 14. Tower

Tower:

```text
building
1x1 footprint
Health
automatic ranged attack
garrisonCapacity = 1
```

`UNDER_CONSTRUCTION` Tower не атакует.

После completion Tower самостоятельно выбирает hostile target и использует target stickiness.

Line-of-sight и projectile entities в #002 отсутствуют. Friendly Walls не блокируют выстрел Tower.

### Empty Tower profile

Рабочая продуктовая семантика:

```text
longer range
slower fire rate
single target
```

### Soldier-garrisoned profile

Soldier меняет **стиль**, а не только линейный коэффициент:

```text
somewhat shorter range
higher fire rate
single target
```

Точные значения находятся в game-data и не являются частью архитектурного контракта.

### Art-direction semantics

Base Tower не должна визуально читаться как необъяснимая магическая автоматика. Даже когда gameplay не моделирует отдельный crew entity, presentation может подразумевать встроенный расчёт, механизм/лебёдку или другую human-side physical operation.

Явный garrison Soldier меняет боевой профиль Tower как дополнительный combatant.

## 15. Garrison — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

Garrison моделируется как generic containment relation между gameplay entities, а не как Tower/Soldier special-case.

### 15.1 Authoritative relation

Container entity имеет host capability/component:

```text
GarrisonHost
└─ capacity
```

Occupant entity имеет authoritative relation:

```text
ContainedIn
├─ containerEntityId
└─ slotIndex
```

Список occupants host является derived query/view из `ContainedIn`; две независимые mutable копии relation не хранятся.

При capacity > 1 свободный slot выбирается deterministic: lowest free `slotIndex`.

### 15.2 Spatial presence vs containment

Ключевой invariant:

```text
ContainedIn(entity) → entity MUST NOT have Position
Position(entity)    → entity MUST NOT have ContainedIn
```

Garrisoned unit остаётся living gameplay entity, но перестаёт быть отдельной spatial entity.

При входе снимаются spatial/runtime transient state, минимум:

- `Position`;
- Movement/NavPath;
- CombatTarget.

Сохраняются:

- entity id;
- Owner;
- Controller;
- Health;
- остальные не-spatial gameplay data.

Это означает evolution Foundation snapshot contract:

> living entity больше не обязана иметь Position; отсутствие Position не означает destruction/absence entity.

Утверждённая representation находится в §23: living entity остаётся в GameStateView и использует `location = CONTAINED { containerEntityId, slotIndex }` вместо WORLD position.

### 15.3 GARRISON is a task, not teleport

Intent:

```text
GARRISON {
  unitEntityId
  containerEntityId
}
```

После initial validation unit получает garrison task и физически движется к valid approach cell container.

При достижении interaction range выполняется повторная validation, потому что за время движения:

- host мог быть уничтожен;
- slot мог быть занят;
- control/ownership/access policy могла измениться;
- host мог стать unavailable.

Только после successful entry создаётся `ContainedIn` и снимается spatial state.

Explicit player MOVE до actual entry отменяет pending garrison task.

### 15.4 Access / permissions

Для #002:

- issuer должен контролировать unit;
- container должен существовать и иметь GarrisonHost;
- Tower должна быть `COMPLETED`;
- должен существовать свободный slot;
- occupant должен удовлетворять allowed capability/tag contract;
- Soldier и Tower в #002 принадлежат одному player.

Same-owner rule #002 не является фундаментальным ограничением containment model.
Future Coop может разрешить allied garrison через access policy без изменения relation representation.

### 15.5 Commands while contained

Owner и Controller сохраняются.

Controller означает право отдавать команды entity, но не означает, что любая command допустима в любом entity state.

Для contained Soldier:

```text
MOVE → rejected (entity_not_spatial или эквивалентная reason)
UNGARRISON → allowed при valid permission/state
```

### 15.6 UNGARRISON

Intent:

```text
UNGARRISON {
  unitEntityId
}
```

Container определяется через `ContainedIn`; container id не обязан дублироваться в payload.

Flow:

```text
validate controller/state
→ resolve container
→ find deterministic valid exit cell
→ remove ContainedIn
→ restore Position at cell center
```

Обычный UNGARRISON использует valid cells вокруг host footprint.

При нескольких допустимых cells выбирается deterministic stable cell order.

Если свободного exit нет:

```text
UNGARRISON rejected: no_exit
```

Unit остаётся contained; teleport через blocked topology запрещён.

### 15.7 Host destruction / forced ejection

При destruction Tower occupants должны быть разрешены до окончательного удаления host relation.

Для #002 sequence:

```text
capture occupants + former footprint
→ remove host solid occupancy
→ deterministic forced ejection
→ destroy host entity
```

Для 1x1 Tower бывшая anchor cell является первым естественным fallback после снятия occupancy; далее допускается deterministic nearby search.

В #002 forced ejection:

- не наносит Soldier дополнительный damage;
- не убивает occupant;
- удаляет `ContainedIn`;
- восстанавливает `Position`.

### 15.8 Combat semantics for contained units

Garrisoned Soldier не является отдельной targetable spatial combat entity.

Enemy атакует Tower, а не occupant внутри.

Damage Tower не прокидывается occupant в #002.

После destruction Soldier eject'ится с сохранённым current Health.

### 15.9 Host combat profile from occupant capability

Tower combat behavior не должен содержать core logic вида:

```text
if Tower && occupant is Soldier
```

Game-data/capability contract определяет interaction между host и occupant.

Концептуально:

```text
Tower definition:
  baseAttackProfile = tower_empty

garrison mode:
  occupant capability/tag = infantry
  → effectiveAttackProfile = tower_infantry
```

Для #002 реально существуют только empty Tower и Tower с Soldier/infantry occupant, но mechanism generic.

Effective combat profile должен быть derived из host definition + current occupants, а не храниться как независимая authoritative mutable копия, пока profiling не докажет необходимость cache.

### 15.10 Presentation / replication consequence

Client видит approved §23 representation:

```text
Soldier:
  location = CONTAINED {
    containerEntityId = Tower #N
    slotIndex = 0
  }

Tower:
  occupant relation derived from contained entities
```

Presentation не рисует отдельный world mesh entity с `location = CONTAINED`, но entity остаётся доступной для UI/state/selection.

Dynamic `Tower.occupants[]` не вводится как второй authoritative/view source.

### 15.11 Lifecycle invariants

Минимальные scenario-testable invariants:

```text
ContainedIn → no Position
Position → no ContainedIn

ContainedIn.containerEntityId
→ existing living entity
→ host has GarrisonHost

slotIndex
→ within host capacity
→ unique among occupants of same host
```

Host destruction не может оставить dangling `ContainedIn` relation.


## 16. Teams / hostility — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

Team/allegiance является отдельным gameplay concept и не выводится напрямую из Owner или Controller.

### 16.1 Owner / Controller / Team

Инвариант:

```text
Owner      → economic/provenance ownership
Controller → command authority
Team       → gameplay/combat allegiance
```

Пример Coop:

```text
Soldier A:
Owner      = Player 0
Controller = Player 0
Team       = Team 0

Soldier B:
Owner      = Player 1
Controller = Player 1
Team       = Team 0
```

Разные owners не означают hostility.

### 16.2 Entity team component

Gameplay entity, участвующая в allegiance/combat rules, имеет generic team component:

```text
Team
└─ teamId
```

`TeamId` — отдельный opaque/stable simulation id. Специальные magic values вроде `-1 = PvE` не используются.

Для #002 минимум Team имеют:

- Worker;
- Soldier;
- Town Hall;
- Wall;
- Tower;
- Construction Site;
- Sacred Site;
- PvE Enemy.

Resource Node и static terrain Team не имеют и считаются neutral/non-combat allegiance.

### 16.3 Player → Team assignment

Match-level state хранит authoritative mapping:

```text
PlayerId → TeamId
```

Entity player-owned spawn/build получает Team из authoritative match assignment.

Entity Team не вычисляется каждый tick через Owner.

Это позволяет PvE и shared objectives иметь Team без Owner.

Для #002:

```text
player(s) → player Team
PvE       → separate PvE Team
```

### 16.4 Relationship resolver

Hostility не определяется правилом:

```ts
teamA !== teamB
```

Gameplay systems используют общий deterministic relationship resolver:

```text
relationship(teamA, teamB)
→ FRIENDLY | NEUTRAL | HOSTILE
```

Допустимы helpers вроде `areHostile` / `areFriendly`, но они должны опираться на relationship policy.

Для #002 relation симметрична:

```text
Player Team ↔ Player Team = FRIENDLY
PvE Team    ↔ PvE Team    = FRIENDLY
Player Team ↔ PvE Team    = HOSTILE
no Team     ↔ anything    = NEUTRAL
```

### 16.5 Relationship policy is match-level

Relationship policy хранится на уровне match/game mode state/config, а не как дублируемая component каждой entity.

#002 не вводит diplomacy system, но relationship representation не должна блокировать будущие:

- Coop teams;
- PvP/PvPvE teams;
- neutral factions;
- scenario relationships.

Asymmetric diplomacy, temporary alliances и team switching находятся вне #002.

### 16.6 Combat uses hostility + targetability

Combat не должен атаковать entity только потому, что её Team отличается.

Valid attack target требует отдельных условий:

```text
hostile relationship
+
targetability / allowed target kind
+
destructible/Health where applicable
```

Пример:

```text
Wall:
  hostile to PvE + breachable/destructible → valid blocker/combat target

Resource Node:
  no Team / NEUTRAL → не hostile combat target
```

Friendly fire в #002 отсутствует.

### 16.7 Sacred Site

В #002 Sacred Site:

```text
Owner      = null
Controller = null
Team       = player/shared Team

Objective:
  type     = PROTECT
  entityId = Sacred Site entity
  teamId   = player/shared Team
  required = true
```

`Sacred Site` остаётся concrete entity/definition identity; generic Objective role — `PROTECT`, согласно §21.

Это сохраняет objective как team-level protected target и не привязывает его к конкретному player.

PvE может атаковать Sacred Site через HOSTILE relationship.

### 16.8 PvE entities

Basic PvE enemy:

```text
Owner      = null
Controller = null
Team       = PvE Team
```

AI/combat/blocker planner используют Team relationship resolver, а не Owner/Controller.

Approved breach-aware planning из §8.7 трактует blocker как hostile именно через Team relationship.

### 16.9 Disconnect / control transfer / garrison

Изменение Controller не меняет Team.

Пример после disconnect:

```text
Owner      = Player 0
Controller = null
Team       = Team 0
```

Передача control другому player также не меняет allegiance автоматически.

Garrison не меняет Team occupant или host.

Same-owner garrison requirement в #002 остаётся отдельной access policy и не заменяется Team semantics.

### 16.10 Determinism and scope

Team assignment и relationship policy deterministic и не используют RNG.

В #002 не реализуются:

- diplomacy UI;
- declare war;
- alliances;
- reputation;
- temporary treaties;
- asymmetric relationships;
- runtime team switching.

Архитектура лишь сохраняет возможность добавить их позже без переписывания combat allegiance model.


## 17. Combat

Минимальные concepts:

```text
Health
AttackProfile
Team/Faction
CombatTarget
```

AttackProfile содержит минимум:

```text
damage
range
cooldownTicks
allowedTargets
```

Attack применяется только на simulation tick.

Нет armor, crit, resistances, status effects и projectile simulation.

### Death

```text
health <= 0
→ gameplay death
→ entity removed from active gameplay world
```

Corpse entities отсутствуют.

Target selection при равной дистанции должен иметь deterministic tie-break.

## 18. Soldier

В #002 один стартовый melee Soldier. Production отсутствует.

Conceptual states:

```text
IDLE
MOVING
ENGAGING
GARRISONED
DEAD
```

### MOVE

Обычный MOVE не является ATTACK_MOVE.

Во время explicit MOVE automatic combat не должен отменять приказ пользователя.

После достижения destination Soldier возвращается в `IDLE`.

### Auto-aggro

Зафиксировано:

- небольшой `aggroRadius`;
- ограниченный `chaseRadius`.

### Target stickiness

Зафиксировано:

> Soldier сохраняет текущую цель, пока она жива, hostile, достижима и находится в допустимом chase radius.

Новый explicit MOVE отменяет combat target.

## 19. PvE enemy

Один archetype:

```text
basic melee enemy
```

Главная стратегическая цель:

> добраться до Sacred Site и уничтожить его.

Базовое поведение:

```text
path toward Sacred Site
→ move
→ nearby local combat?
   ├─ yes: engage defender
   └─ no: continue objective
```

Enemy не должен уходить через половину карты за Worker.

После завершения локального боя возвращается к objective behavior.

Если normal path к Sacred Site невозможен, применяется утверждённый breach-aware blocker-selection contract из §8.7:
enemy выбирает первый breachable blocker на deterministic minimal-breach route, подходит к его attack approach cell,
держит blocker target до invalidation/destruction и после разрушения заново проверяет normal objective path.

Behavior tree framework в #002 не требуется.

## 20. Wave lifecycle

Отдельное gameplay state:

```text
PREPARING
→ WARNING
→ ACTIVE
→ CLEARED
```

В #002 только одна wave.

### PREPARING

Игрок получает время на:

- gathering;
- construction;
- positioning;
- garrison.

### WARNING

Перед spawn появляется player-visible предупреждение.

Timing задаётся через game-data/test configuration, а не через wall-clock simulation logic.

### ACTIVE

Enemies появляются из фиксированного spawn region.

Spawn staggered и deterministic. Seeded RNG допустим при сохранении repeatability.

### CLEARED

```text
all scheduled enemies spawned
AND
all wave enemies dead
→ WAVE_CLEARED
```

Зафиксировано:

> **WAVE_CLEARED не является Victory.**

После очистки:

```text
Match = RUNNING
Wave = CLEARED
```

## 21. Sacred Site / generic Objective / defeat

Sacred Site — concrete world/entity identity, а Objective — generic gameplay role.

```text
Entity:
  definitionId = "sacred_site"
  Health
  Team = player/shared Team
  Owner = null
  Controller = null

Objective:
  type = PROTECT
  entityId = sacredSiteEntityId
  teamId = player/shared Team
  required = true
```

Engine не использует `ObjectiveType = SACRED_SITE` как фундаментальную модель. Future objectives могут назначать `PROTECT / DESTROY / CAPTURE` другим entities.

При `Sacred Site health <= 0` shared runtime устанавливает `DEFEAT(playerTeam)`, а session shell отражает `FINISHED`.

Это единственное match-ending condition #002. Victory отсутствует; `WAVE_CLEARED` не victory.

## 22. Protocol / command validation — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

### 22.1 Validation / admission layers

Untrusted client payload проходит разные boundary:

```text
unknown payload
→ protocol/schema validation
→ typed GameCommand
→ session/transport validation
→ trusted actor context + command
→ shared runtime admission
   ├─ per-player queue cap
   └─ COMMAND_REJECTED(queue_full) if full
→ bounded per-player FIFO queues
→ deterministic fair scheduler on simulation tick
→ gameplay semantic validation against current world
→ apply / reject
```

Transport/application boundary отвечает за schema/session/match-phase/transport limits.

MatchRuntime admission отвечает только за bounded command ingress; `queue_full` не читает gameplay world state.

Simulation tick-boundary validation отвечает за gameplay semantics:

- Controller permission;
- entity existence/state;
- resource availability;
- placement;
- path/reachability;
- construction/garrison conditions;
- другие gameplay rules.

Gameplay validation/admission semantics не должны дублироваться отдельными Local и Remote implementations.

### 22.2 Semantic validation happens on tick boundary

Команда не считается gameplay-valid только потому, что была valid в момент network receive.

После schema/session checks и успешного bounded admission trusted command попадает в FIFO queue своего player.

На simulation tick deterministic fair scheduler выбирает commands из per-player queues согласно §8.8. Каждая scheduled command проверяется против **текущего world state**, уже учитывающего ранее применённые commands этого tick.

Пример conflict:

```text
scheduler chooses Player A BUILD cell X
→ accepted, occupancy changes

later same tick scheduler chooses Player B BUILD cell X
→ rejected: invalid_placement
```

Same-tick winner определяется scheduler order, а не raw network arrival order между players.

Gameplay mutation одной применяемой command должна быть atomic относительно command application.

`queue_full` — единственная из описанных здесь backpressure reasons, которая может возникнуть до tick-boundary semantic validation, потому что command вообще не попала в pending queue.

### 22.3 Trusted actor context

Public GameCommand не содержит authoritative identity:

- playerId;
- teamId;
- ownerId;
- session identity.

Remote host выводит PlayerId из server session/slot.
Local host назначает Local PlayerId внутри trusted local runtime.

В shared per-player simulation command queues actor context отделён от gameplay intent концептуально:

```text
QueuedCommand
├─ actor.playerId
└─ command: SimulationCommand
```

`sessionId` остаётся host/logging concern и не входит в simulation.

### 22.4 Public command set #002

В #002 используются:

```text
MOVE
GATHER
BUILD
GARRISON
UNGARRISON
```

Отдельный ATTACK не вводится; Soldier/Tower/PvE combat automatic.

#### MOVE

```text
entityIds[]
target { x, y }   // world-space
```

MOVE сохраняет continuous world-space semantics.

#### GATHER

```text
workerEntityId
resourceEntityId
```

Client не передаёт resource position/type/remaining amount как authority.

#### BUILD

```text
builderEntityId

target:
  | NEW {
      buildingTypeId
      anchorCell { x, y }
    }
  | EXISTING {
      constructionEntityId
    }
```

`NEW` использует grid anchor, потому что placement/grid occupancy являются gameplay contract. `buildingTypeId` — bounded data identifier, а не обязательный protocol enum для каждого будущего building definition.

`EXISTING` адресует уже созданную `UNDER_CONSTRUCTION` entity и позволяет тому же или другому допустимому Worker продолжить paused construction без повторной оплаты.

Simulation валидирует definition/access/state/reachability в зависимости от variant.

#### GARRISON

```text
unitEntityId
containerEntityId
```

#### UNGARRISON

```text
unitEntityId
```

Container определяется через approved `ContainedIn` relation.

### 22.5 Command metadata and ordering

Существующие `commandId` и `clientSequence` сохраняются.

`commandId` используется для correlation/rejection/diagnostics.

`clientSequence` является client/transport metadata и **не задаёт authoritative gameplay ordering между players**.

Authoritative ordering #002:

```text
within one player:
  trusted enqueue order → strict FIFO

between players:
  deterministic round-robin scheduler
  with persistent player cursor
```

Raw cross-player packet arrival timing не определяет winner same-tick gameplay conflicts.

При одинаковых:

- participant/player IDs;
- per-player queued command sequences;
- scheduler cursor/config;
- initial world state;

simulation должна давать одинаковый ordering/result.

Replay/deduplication protocol поверх `clientSequence` находится вне #002.

### 22.6 Command rejection vs later task failure

Нужно различать два lifecycle.

#### COMMAND_REJECTED

Команда не начала gameplay action.

Примеры stable machine-readable reasons:

```text
invalid_schema
not_running
queue_full
not_controller
entity_not_found
entity_not_spatial
blocked_target
insufficient_resources
invalid_placement
no_path
no_dropoff
no_garrison_slot
no_exit
construction_busy
already_building
```

#### ACTION_FAILED

Команда была применена и долгоживущая task стартовала, но позже world изменился так, что task нельзя завершить.

Примеры:

```text
GARRISON accepted
→ unit идёт к Tower
→ slot занят другим unit
→ entry validation fails
→ ACTION_FAILED

MOVE accepted
→ topology changed
→ replan fails
→ ACTION_FAILED
```

Это не retroactive `COMMAND_REJECTED`.

Для meaningful asynchronous failure protocol должен иметь one-shot event концептуально:

```text
ACTION_FAILED
├─ commandId
├─ entityId
├─ action
└─ reason
```

Нормальное завершение lifecycle не считается failure. Например истощение ResourceNode → final deposit → Worker IDLE.

### 22.7 BUILD lifecycle and atomicity

#### NEW

`BUILD NEW` применяется только если на tick одновременно валидны минимум:

- Controller permission;
- builder capability;
- building definition;
- resource cost;
- buildability;
- footprint occupancy;
- builder reachability/valid build approach.

Successful application атомарно выполняет:

```text
spend Wood
+ create construction entity
+ register solid footprint
+ start Worker construction task
```

После этого поздняя невозможность продолжить construction не возвращает ресурсы и не отменяет созданный site.

#### EXISTING

`BUILD EXISTING` валидирует existing Construction Site и builder, но:

- не списывает Wood;
- не создаёт entity;
- не регистрирует footprint повторно;
- не сбрасывает progress.

Successful application только назначает/возобновляет construction task для existing site.

Если site уничтожена/завершена/занята другим active builder до command application, command отклоняется соответствующей machine-readable reason.

### 22.8 Two-phase task validation

GARRISON и GATHER естественно имеют initial validation при command application и повторную validation на момент interaction.

GARRISON entry повторно проверяет host/slot/access.

GATHER arrival повторно проверяет target existence/resource remaining.

World changes после command acceptance обрабатываются task lifecycle, а не разными Remote/Local command rules.

### 22.9 Protocol hardening

Zod/wire schemas остаются strict.

Все потенциально unbounded client fields должны иметь разумные limits:

- string lengths;
- arrays;
- numeric domains;
- finite world coordinates;
- bounded identifier sizes.

Конкретные security constants определяются implementation/config, но unbounded gameplay payload запрещён архитектурно.

### 22.10 Client sends intent only

Client никогда не является authority для:

- PlayerId / TeamId;
- current resources;
- Health / damage;
- construction progress;
- path result;
- gather amount;
- target selection;
- attack cooldown;
- wave progression;
- match result.

Client отправляет intent + entity/data references; authoritative gameplay result вычисляется shared simulation.

### 22.11 Stable machine-readable failure codes

Failure/rejection reason является stable machine-readable code, а не локализованным human text.

UI сам отображает локализованное сообщение.

Для malformed payload без валидного commandId целевое protocol направление — nullable/optional command correlation вместо semantic sentinel `"unknown"`; конкретная wire migration определяется implementation issue вместе с PROTOCOL_VERSION bump.

### 22.12 Local / Remote convergence

Foundation-style pre-validation gameplay rules в Remote `SimulationHost` и отдельная Local command-validation копия являются временным foundation shape.

Целевой #002 flow:

```text
Remote host                   Local host
    │                             │
schema/session checks       schema/session checks
derive trusted PlayerId     derive trusted PlayerId
    │                             │
    └──── trusted command ────────┘
                  ↓
     shared bounded per-player command queues
                  ↓
              World.step
                  ↓
       semantic gameplay validation
                  ↓
             systems/tasks
```

Shared placement уже утверждён §26 / ADR-009:

- `MatchRuntime` живёт в `@web-rts/simulation`;
- protocol↔simulation command/state/event mapping живёт в `@web-rts/match-adapter`;
- Remote Colyseus Room и Local WebWorker остаются thin session/scheduler shells.

Breaking wire changes требуют `PROTOCOL_VERSION` bump по существующему contract.


### 22.13 Foundation input/session hardening — RECONCILED FROM #53

Remote Room задаёт explicit message-rate limit (`maxMessagesPerSecond` или equivalent mechanism). Точное число — implementation/config decision.

Client-controlled fields bounded:

- `commandId` / identifier lengths;
- `entityIds[]` max length;
- numeric domains / finite coordinates;
- payload shape.

Shared MatchRuntime дополнительно имеет:

```text
maxPendingCommandsPerPlayer
maxCommandsPerTick
```

Per-player pending queue cap обязателен **и для Local, и для Remote**. Remote message-rate limit не считается заменой queue cap.

При заполненной player queue новая trusted command отклоняется `queue_full`, не вытесняя старые commands.

После START Remote Room блокирует новые joins:

```text
LOBBY → joins allowed
STARTING/RUNNING/FINISHED → new joins locked
reserved reconnect → allowed по reconnect policy
```

Required security/fairness regression:

```text
Player A continuously submits max-cost MOVE within allowed rate
Player B submits valid command
→ A pending queue never exceeds cap
→ B command receives service within deterministic bounded number of ticks
→ AI/replan lanes continue making progress
```

Exact bound выводится из configured participant count, `maxCommandsPerTick`, round-robin scheduler и command/path budgets; test обязан фиксировать конкретную config и ожидаемый upper bound.

### 22.14 Complete GameTransport session boundary — RECONCILED FROM #53

UI не зависит от concrete `PageGameTransport`. Target `GameTransport` включает gameplay/state/event methods плюс:

```text
startMatch()
connectedRoomId
hasResumeToken()
readRoundTripMs()
```

Local естественно не имеет remote resume token. START остаётся session control, не gameplay command.

## 23. Replication / GameStateView — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

### 23.1 Projection, not serialized World

`GameStateView` остаётся presentation-oriented projection и не копирует component stores/runtime internals simulation.

```text
Simulation World
→ transport-neutral snapshot/projection
→ per-recipient replication policy
→ GameStateView
→ ClientGameState
→ HUD + interpolation/presentation
```

В #002 используются full snapshots. Delta replication, dirty masks, binary protocol, compression и interest management не вводятся до profiling/measurement.

### 23.2 Static data through definitionId

Каждая gameplay entity получает stable `definitionId`, связанный с `game-data`.

Примеры:

```text
worker
soldier
enemy_melee
town_hall
wall
tower
sacred_site
wood_node
```

Static definition data (footprint, base stats, cost, garrison capacity, attack profiles, resource type и т.п.) не дублируется каждый tick без необходимости.

Совместимость static definitions защищается существующим `GAME_DATA_VERSION`.

### 23.3 Broad entity kind + data definition

View использует широкую category:

```text
UNIT
BUILDING
RESOURCE
OBJECTIVE
```

и отдельный `definitionId`.

Protocol не расширяется отдельным enum variant для каждого нового конкретного unit/building definition.

### 23.4 Location is discriminated

Обязательные `x/y` заменяются semantic location union:

```text
WORLD {
  x,
  y
}

CONTAINED {
  containerEntityId,
  slotIndex
}
```

Это выражает approved garrison invariant прямо в view contract.

Living entity без Position не исчезает из snapshot/view.

### 23.5 Living entity != spatial entity

Transport-neutral snapshot обходит living gameplay entities, а не только entities с Position.

Contained Soldier остаётся в replicated entity collection:

```text
entityId
Owner
Controller
Team
Health
location = CONTAINED(...)
```

Отсутствие WORLD position не означает destruction.

### 23.6 Composed entity view

Wire/view model не строит OOP hierarchy `UnitView → SoldierView` / `BuildingView → TowerView`.

Entity projection composition-oriented:

```text
entityId
kind
definitionId
location

ownerPlayerId
controllerPlayerId
teamId
relationToLocal

health?
construction?
resourceNode?
objective?
```

Конкретная Zod representation может группировать поля в nested objects, но public semantics должны оставаться capability/composition-oriented.

### 23.7 Recipient relationship

Entity view содержит:

```text
teamId | null
relationToLocal:
  FRIENDLY | NEUTRAL | HOSTILE
```

`relationToLocal` вычисляется authoritative per-recipient projection через approved Team relationship resolver.

Client не выводит hostility правилом `teamId !== localTeamId`.

### 23.8 Health projection

Для destructible entities view содержит effective:

```text
health {
  current
  max
}
```

Даже если base max находится в game-data, effective max может позже меняться modifiers/upgrades.

Client не является authority для Health.

### 23.9 Construction projection

Для active construction достаточно presentation state:

```text
construction {
  progress // normalized 0..1
}
```

Internal worked ticks, builder accumulators и construction system state не реплицируются.

Completed building не обязано сохранять construction object.

### 23.10 Resource node projection

Resource node dynamic view минимум содержит:

```text
resourceNode {
  remaining
}
```

Static resource semantics берутся из `definitionId` / game-data.

### 23.11 Garrison relation has one view source

Contained occupant relation реплицируется occupant-side через `location = CONTAINED`.

View не обязан дублировать authoritative dynamic relation отдельным `Tower.occupants[]`.

Client может derived-query occupants host по `containerEntityId`.

Static host capacity хранится в game-data definition.

### 23.12 Spatial interpolation rules

Interpolation применяется только к continuous transition:

```text
WORLD → WORLD
```

Spatial discontinuities сбрасывают interpolation history entity:

```text
WORLD → CONTAINED
→ немедленно убрать world mesh / pose history

CONTAINED → WORLD
→ fresh spatial spawn at authoritative Position

destroyed
→ remove entity
```

Нельзя lerp'ить Soldier от pre-garrison Position к post-ungarrison Position.

### 23.13 Selection and non-spatial entities

Gameplay selection не обязана исчезать при garrison, потому что contained entity остаётся в `entities`.

Presentation world mesh для non-WORLD entity отсутствует, но UI может продолжать показывать selected Soldier и action `UNGARRISON`.

### 23.14 Players and teams

`PlayerSlotView` расширяется минимум:

```text
playerId
connected
teamId
```

Team membership полезна UI, но relationship semantics по-прежнему authoritative и не вычисляется простым сравнением team ids.

### 23.15 Economy projection

Gameplay economy отделена от lobby/player connection state.

Концептуально:

```text
playerEconomies [
  {
    playerId
    resources [
      { resourceTypeId, amount }
    ]
  }
]
```

В #002 recipient минимум получает собственную economy.

Replication policy определяет, какие allied/opponent economies разрешено видеть; отсутствие Fog в #002 не означает автоматическую утечку будущей enemy economy.

### 23.16 Wave is persistent replicated state

GameStateView top-level содержит effective runtime tick rate:

```text
tick
tickRateHz
```

`tickRateHz` immutable для текущего match runtime и не должен hardcode'иться client'ом.

Wave lifecycle реплицируется top-level persistent state:

```text
wave {
  index
  phase: PREPARING | WARNING | ACTIVE | CLEARED
  phaseEndsAtTick | null
}
```

Simulation source of truth — ticks, а не wall-clock seconds.

UI рассчитывает countdown:

```text
max(0, phaseEndsAtTick - tick) / tickRateHz
```

`WAVE_CLEARED` является state, а не единственным one-shot event.

### 23.17 Match result is persistent

Top-level result:

```text
null
or
DEFEAT {
  defeatedTeamId
}
```

Для #002:

```text
wave = CLEARED
phase = RUNNING
result = null
```

и при destruction Sacred Site:

```text
phase = FINISHED
result = DEFEAT(playerTeam)
```

Union result может расширяться позже при появлении victory conditions.

### 23.18 Map identity is replicated

`GameStateView` содержит `mapId`.

Client использует `mapId + game-data` как source of truth для map presentation bounds/layout data.

Presentation не хранит независимый gameplay map size вроде собственного hardcoded `RTS_MAP_HALF_EXTENT`.

### 23.19 Internal simulation data is not replicated

Не являются public view contract без отдельного UI/use-case:

- A* paths/open sets;
- current waypoint index;
- AI evaluation scores;
- breach planner result;
- topologyRevision;
- raw task objects;
- raw attack cooldown implementation;
- RNG state;
- command queues / scheduler internals;
- component stores.

Если UI нужен coarse activity state, он добавляется как dedicated presentation projection, а не экспорт internal state machine.

### 23.20 Per-recipient projection

Даже без Fog of War #002 сохраняет per-recipient projection boundary.

Recipient-specific минимум:

- `localPlayerId`;
- `relationToLocal`;
- visible player economies.

World visibility в #002 может быть одинаковой для всех recipients.

Remote server и Local path должны использовать одинаковую projection semantics.

### 23.21 Persistent state vs events

Persistent/reconnect-critical gameplay state находится в snapshot:

- entities/location;
- Health;
- construction;
- resource amounts;
- containment;
- wave;
- match result.

One-shot events используются для:

- `COMMAND_REJECTED`;
- `ACTION_FAILED`;
- `PROTOCOL_MISMATCH`;
- будущих transient VFX/SFX cues при необходимости.

Критический gameplay state не должен восстанавливаться только через историю events.

### 23.22 Reconnect completeness

Fresh authoritative snapshot после reconnect должен быть достаточен, чтобы восстановить текущий gameplay view:

- living/spatial/contained entities;
- Tower/Soldier containment;
- construction progress;
- economy;
- wave state;
- Sacred Site health;
- match result.

Replay прошлых gameplay events для восстановления state не требуется.

Breaking wire changes требуют `PROTOCOL_VERSION` bump.


### 23.23 Concrete replication strategy for #002 — RECONCILED FROM #53

```text
runtime.readSnapshot() once per simulation tick
→ shared per-recipient projection
→ full GameStateView message
→ GameTransport
```

Один transport-neutral MatchSnapshot вычисляется один раз на tick. Full snapshots — current-stage baseline. Delta/patch/Colyseus Schema/binary encoding вводятся только после profiling и не меняют simulation model.

## 24. Presentation / UI minimum

Developer/proxy art допустим и не фиксирует финальный visual design.

#002 должен быть играем без Inspector/debug console: Wood, Worker/GATHER, BUILD Wall/Tower, placement feedback, construction progress, Soldier MOVE, GARRISON/UNGARRISON, HP, wave state, WAVE_CLEARED и DEFEAT.

### Player-color semantics

```text
Owner / explicit shared-team visual policy → player/team color
Controller → command authority only
```

Temporary loss/transfer of Controller не должен сам по себе перекрашивать owned entity.

### Single spatial-transform owner

Authoritative snapshots обновляют ClientGameState. Babylon spatial transform обновляется одним per-frame interpolation/render path. Snapshot-arrival path не должен быть вторым writer'ом per-frame position/rotation.

React не хранит per-frame transforms.

### Representative Art Direction target

После gameplay integration, но до массового production art, нужен небольшой Babylon target:

- representative human unit;
- Town Hall / Wall / Tower;
- Sacred Site proxy/hero asset;
- environment patch;
- player-color accents;
- normal gameplay zoom;
- strategic overview;
- небольшая defense scene для density/readability.

Это не production-art gate для ранних gameplay stages. Final PvE identity остаётся отдельной art task; basic melee enemy — gameplay archetype. Concept references не добавляют mechanics в scope.

Camera rewrite не требуется автоматически: сначала проверяется фактическая читаемость target.

## 25. Determinism

Обязательны fixed timestep, seeded RNG, no gameplay `Math.random()`, no simulation wall-clock, deterministic A*/budget/targets/blockers/garrison ejection и stable processing order.

Для одинаковых seed/map/participants/ordered commands/tick count simulation даёт одинаковый gameplay result.

Repository lint/config должен автоматически запрещать в `packages/simulation` gameplay `Math.random`, `Date.now`/`performance.now` и framework imports, где это практически возможно.

## 26. Shared Local / Remote Match Runtime — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

### 26.1 One shared gameplay runtime

Local и Remote execution используют один framework-agnostic match runtime boundary.

Рабочее архитектурное имя:

```text
MatchRuntime
```

Он не является transport, renderer, Colyseus Room или WebWorker API.

```text
Remote shell             Local shell
Colyseus Room            WebWorker
      \                    /
       \                  /
          MatchRuntime
               │
        shared simulation
```

Точное TypeScript API определяется implementation issue, но semantic surface минимум позволяет:

- создать runtime из seed/map/participants;
- admit/enqueue trusted player command в bounded per-player queue;
- выполнить explicit `step()`;
- прочитать transport-neutral snapshot;
- drain transport-neutral runtime events;
- получить explicit diagnostics/metrics;
- выполнить trusted host operations для permanent player removal: очистить pending ingress queue и release control.

### 26.2 Runtime ownership

Shared runtime владеет gameplay match execution boundary:

- simulation World;
- runtime map/grid state;
- gameplay bootstrap;
- player/team match setup;
- player economies;
- wave/result state;
- bounded per-player command queues + deterministic command scheduler;
- gameplay system stepping;
- simulation/runtime events.

Gameplay rules остаются в shared simulation systems; runtime не создаёт альтернативный rules engine.

Не должно быть отдельных gameplay bootstrap implementations для Remote и Local.

### 26.3 Transport/session shells remain different

Remote shell продолжает владеть:

- Colyseus Room;
- auth/sessionId;
- join/leave;
- player slot allocation;
- reconnect grace;
- WebSocket;
- server/network logging context;
- tick scheduling.

Local shell продолжает владеть:

- Worker lifecycle;
- main ↔ worker bridge;
- local session identity;
- trusted Local PlayerId assignment;
- timer/scheduler;
- worker termination.

Colyseus и WebWorker internals не абстрагируются в общий fake transport layer внутри gameplay runtime.

### 26.4 Runtime has no timers

MatchRuntime/simulation не вызывает wall-clock APIs.

```text
Remote scheduler → runtime.step()
Local scheduler  → runtime.step()
```

В gameplay runtime запрещены:

- `setInterval`;
- `setTimeout`;
- `Date.now()`;
- `performance.now()`.

Gameplay time определяется simulation tick.

### 26.5 Shared match bootstrap

Перед созданием RUNNING match shell формирует trusted setup:

```text
MatchSetup
├─ seed
├─ mapId
└─ participants
   ├─ playerId
   └─ teamId
```

Один shared bootstrap создаёт/инициализирует:

- map runtime/grid;
- teams/economies;
- starting Town Hall;
- Worker;
- Soldier;
- Sacred Site;
- Resource Nodes;
- wave state.

Application shell не содержит gameplay placement rules.

### 26.6 Lobby remains application/session concern

`LOBBY` и connection lifecycle не переносятся в simulation.

Flow:

```text
session/application LOBBY
→ START
→ resolve MatchSetup
→ create shared MatchRuntime
→ RUNNING
```

Gameplay terminal result определяется runtime/simulation.

Например Sacred Site destruction создаёт DEFEAT result, после чего shell отражает `FINISHED`.

### 26.6.1 Audit #53 H1 interpretation

Audit #53 предлагал общий модуль в том числе для match phases. #002 намеренно **не централизует transport/session lifecycle целиком**:

```text
LOBBY / join / reconnect / room lock
→ shell-owned session state

gameplay bootstrap / RUNNING gameplay / terminal result
→ shared MatchRuntime semantics
```

Это deliberate deviation от буквальной формулировки H1, а не незакрытый architecture gap.

Обязательное требование вместо shared session manager: Local и Remote имеют одинаковые **observable gameplay lifecycle semantics** для START → RUNNING → FINISHED и одинаковую gameplay projection/rejection behavior. Это покрывается parity/integration tests.

### 26.7 Shared trusted command ingress

После protocol/schema/session checks оба path сходятся в один ingress:

```text
Remote                         Local
  │                              │
parse schema                   parse schema
derive trusted PlayerId       derive trusted PlayerId
  │                              │
  └──── trusted command ─────────┘
                 ↓
            MatchRuntime
                 ↓
     bounded per-player queues + fair scheduler
                 ↓
        tick-boundary validation
```

Remote `SimulationHost` и Local runtime не должны поддерживать отдельные `assessMove/assessBuild/...` gameplay rules до enqueue.

### 26.8 One protocol → internal command mapper

Protocol-to-simulation mapping должен иметь одну shared pure implementation.

Mapper:

- принимает typed/validated GameCommand;
- удаляет transport-only metadata вроде `clientSequence`;
- не принимает client-supplied identity;
- не переносит sessionId в simulation;
- не выполняет gameplay semantic validation.

Remote и Local не содержат два независимых `switch(command.type)`.

Mapper находится в утверждённом `@web-rts/match-adapter` согласно §26.18 / ADR-009.

### 26.9 Runtime events carry recipient identity

Поскольку gameplay rejection/failure может возникнуть на simulation tick, transport shell должен понимать recipient.

Transport-neutral runtime event концептуально содержит:

```text
recipientPlayerId
+
runtime event payload
```

Remote shell переводит PlayerId в текущую Colyseus session.
Local shell доставляет event локальному player через worker bridge.

Transient event может быть потерян при disconnect; persistent gameplay state остаётся восстановим fresh snapshot.

### 26.10 Shared state projection

Remote и Local не должны иметь отдельные implementations:

```text
server replication-adapter
vs
local projectLocalState/toEntityView
```

Один shared projector получает:

- transport-neutral match snapshot;
- recipient PlayerId/context;
- session-level view metadata (room id, connected players/phase where needed);

и создаёт одинаковую gameplay semantics `GameStateView`:

- relationToLocal;
- allowed economies;
- entities;
- wave;
- result;
- mapId;
- team information.

Transport-specific metadata может отличаться, gameplay projection — нет.

### 26.11 Snapshot and runtime events remain transport-neutral

Simulation/runtime layer не импортирует wire DTO как authoritative state.

```text
runtime snapshot != GameStateView
runtime event    != wire GameEvent
```

Shared adapters/projectors переводят transport-neutral data в protocol contracts.

`packages/simulation` по-прежнему не импортирует `@web-rts/protocol`.

### 26.12 Application code does not inspect World internals

Production application shells не должны читать component stores/World для gameplay decisions или replication.

Используются explicit runtime APIs:

```text
readSnapshot()
readMetrics()
drainEvents()
```

Server diagnostics получают минимум tick/entityCount/pendingCommandCount через runtime metrics, а не через прямой доступ к component stores.

Low-level simulation tests могут тестировать World напрямую.

### 26.13 Disconnect / reconnect operations

Unexpected Remote drop:

- runtime продолжает simulation;
- Owner/Controller остаются в grace period;
- reconnect не создаёт новый gameplay runtime.

Permanent leave/timeout:

```text
trusted host operation
→ runtime.removePlayerFromCommandIngress(playerId)
   ├─ atomically discard all not-yet-applied pending commands for player
   └─ remove player queue / scheduler participation
→ runtime.releaseControlForPlayer(playerId)
```

Pending commands, отброшенные из-за permanent leave, **не превращаются в `COMMAND_REJECTED` events**: recipient уже окончательно отсутствует, а commands никогда не применяются к gameplay world.

Это cleanup trusted host lifecycle, а не public GameCommand и не gameplay semantic rejection.

Unexpected disconnect внутри reconnect grace **не очищает** player queue автоматически: reserved session/player сохраняется согласно reconnect policy.

Уже применённые gameplay tasks не считаются pending commands и этим cleanup не откатываются; их дальнейшее поведение определяется существующими control/task rules.

Local disconnect завершает/dispose локальный runtime целиком; transport lifecycle здесь намеренно отличается.

### 26.14 GameTransport start boundary

`startMatch()` должен стать частью публичного `GameTransport` interface, поскольку UI уже должен одинаково запускать Local и Remote path.

START остаётся session/application control message, а не gameplay GameCommand.

Presentation/UI не должны зависеть от concrete Local/Remote transport type ради запуска матча.

### 26.15 Match finish

Runtime/simulation определяет gameplay result.

После terminal result shell отражает:

```text
phase = FINISHED
result = ...
```

Новые gameplay commands после FINISHED отклоняются на host/session boundary как `not_running`.

Final runtime snapshot остаётся доступен для presentation/reconnect/final screen до disposal session.

### 26.16 Local / Remote parity tests

#002 требует equivalence tests:

```text
same seed
same map
same participants
same command sequence
same number of ticks
→ equivalent gameplay state
```

Local-backed и Remote-backed paths сравниваются после normalization transport-specific metadata.

Также одинаковые invalid gameplay commands должны приводить к одинаковым machine-readable gameplay reasons.

Это first-class regression защита принципа:

> Solo и multiplayer используют одинаковые gameplay rules.

### 26.17 Do not over-abstract transport internals

Не становятся частью shared gameplay runtime:

- Colyseus Room/Client;
- WebWorker MessageEvent;
- sessionId/reconnectToken;
- WebSocket close codes;
- Worker lifecycle;
- network-specific logging context.

Целевая boundary остаётся узкой:

```text
transport/session shell
→ trusted ingress
→ MatchRuntime
→ snapshot/events
→ shared projector
→ transport/session shell
```

Foundation multiplayer/reconnect/browser regressions должны сохраняться.


### 26.18 Package boundaries / system ownership — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

#002 сохраняет существующие core packages и добавляет ровно один production bridge package:

```text
@web-rts/match-adapter
```

Новые packages для navigation/economy/combat/garrison/AI не создаются.

#### Dependency direction

Целевой production graph:

```text
@web-rts/game-data
        │
        ▼
@web-rts/simulation

@web-rts/protocol      @web-rts/simulation
        \                 /
         \               /
          @web-rts/match-adapter
             /           \
            /             \
   apps/game-server      apps/web worker
```

Инварианты:

```text
simulation ─X→ protocol
protocol   ─X→ simulation

match-adapter → simulation
match-adapter → protocol
```

Циклические зависимости запрещены.

#### @web-rts/game-data

`game-data` остаётся declarative-only package и хранит:

- map definitions / terrain/buildability/spawn/resource placement;
- unit definitions;
- building definitions;
- resource definitions;
- costs/build times/footprints;
- combat balance values;
- garrison capability/profile mapping;
- wave definitions/timing/composition.

`game-data` не содержит:

- A*;
- occupancy mutation;
- combat resolution;
- construction progression;
- AI;
- target selection;
- placement validation.

Смысл boundary:

```text
game-data = что существует и с какими параметрами
simulation = как это ведёт себя
```

#### @web-rts/simulation

Вся gameplay truth остаётся в `@web-rts/simulation`.

Именно здесь живут:

- `MatchRuntime`;
- World / entity registry / components;
- grid / occupancy / topology revision;
- world↔cell conversion;
- navigation / A* / approach goal sets;
- breach-aware path planning;
- bounded per-player command queues + fair scheduling + semantic validation;
- economy / Worker tasks;
- construction;
- combat / targeting / death;
- garrison / containment / ejection;
- teams / relationships;
- PvE AI;
- waves;
- objectives/result;
- transport-neutral MatchSnapshot;
- transport-neutral RuntimeEvents;
- RuntimeMetrics.

Не создаются отдельные production packages `navigation`, `combat`, `economy`, `garrison`, `ai` без нового доказанного use case.

`MatchRuntime` является production facade Simulation Core.

Production application code должно использовать public facade вроде:

```text
createMatchRuntime
MatchSetup
MatchRuntime
SimulationCommand
RuntimeEvent
MatchSnapshot
RuntimeMetrics
```

и не зависеть от arbitrary internal component stores/system functions.

Low-level simulation tests могут обращаться к World/internal modules по разрешённому package API.

#### @web-rts/protocol

`@web-rts/protocol` владеет только wire/client contracts:

- Zod GameCommand schemas;
- GameEvent schemas;
- GameStateView schemas;
- GameTransport;
- protocol/game-data compatibility versions;
- parse helpers.

Protocol не импортирует simulation и не содержит gameplay algorithms.

#### @web-rts/match-adapter

Новый package оправдан тем, что он является единственной integration boundary между protocol и simulation и используется одновременно Remote и Local execution paths.

Он владеет тремя pure-direction adapters:

```text
GameCommand
→ internal SimulationCommand

MatchSnapshot + RecipientContext + SessionViewContext
→ GameStateView

RuntimeEvent
→ GameEvent
```

Он:

- удаляет transport-only metadata из commands;
- не выполняет gameplay validation;
- строит recipient-specific protocol projection;
- маппит transport-neutral runtime events в wire events;
- не хранит authoritative gameplay state;
- не становится вторым gameplay/runtime layer.

#### apps/game-server

Server app владеет:

- Colyseus server/Room;
- auth;
- slots;
- join/leave/reconnect;
- tick scheduler;
- network/logging context;
- lifecycle MatchRuntime;
- вызовами match-adapter.

Server app не содержит:

- gameplay command validators;
- economy/combat/navigation rules;
- direct component-store access для production logic;
- собственную entity/GameStateView projection.

#### apps/web

Browser main thread владеет:

- React UI;
- Babylon presentation;
- ClientGameState;
- input/selection;
- LocalGameTransport;
- RemoteGameTransport.

WebWorker shell владеет:

- Worker messaging;
- local session identity;
- scheduler;
- lifecycle MatchRuntime;
- вызовами match-adapter.

Web app не содержит отдельный local gameplay bootstrap, local gameplay validation или independent GameStateView projection.

#### @web-rts/testkit and scenario runner

`@web-rts/testkit` может предоставлять:

- match/world builders;
- scenario helpers;
- command helpers;
- snapshot assertions;
- Local/Remote parity fixtures.

Production packages/apps не зависят от testkit.

`tools/scenario-runner` должен по возможности запускать gameplay непосредственно через `MatchRuntime`, без Colyseus/browser protocol path.

#### Client access to game-data

Browser имеет право читать `game-data` для static presentation metadata:

```text
definitionId / mapId
→ static definitions
→ presentation
```

Но dynamic/effective runtime values всегда берутся из `GameStateView`.

Static definition не может переопределять replicated authoritative state.

#### ADR consequences

Эти package/runtime решения уже формализованы в **ADR-008** и **ADR-009** в текущем architecture PR.

ADR-009 развивает ADR-006, а не заменяет его. Technical Vision в этом же PR синхронизирован с `packages/match-adapter` и shared MatchRuntime boundary.


### 26.19 Foundation hardening invariants — RECONCILED FROM #53

Shared MatchRuntime закрывает foundation divergence до новых gameplay commands:

- drains runtime events каждый tick;
- Remote/Local имеют одинаковые rejection/failure semantics;
- trusted actor identity доходит до tick-boundary validation;
- control loss между enqueue/apply может инвалидировать command;
- shells не владеют отдельными gameplay validators;
- one snapshot per tick строится до recipient projections.

Required regression:

```text
enqueue MOVE while controlled
→ release Controller before apply
→ rejected at tick boundary
```

Room lock/rate limit/reconnect остаются Remote shell concerns.

## 27. Automated testing direction

### Simulation / scenario

Покрыть ResourceNode/gather/depletion/no-dropoff failure; BUILD NEW/EXISTING atomicity, same-owner access, immediate reservation while approaching, `construction_busy`, `already_building`, release-on-cancel/death/failure/destroy/complete; construction/occupancy; deterministic A*/lane budgets/replan/breach planning, включая `MAX_MOVE_ENTITY_IDS <= commandBudget`, bounded per-player command queues, deterministic cross-player round-robin, no head bypass within player, no cross-player starvation, no AI/replan starvation при player spam, ascending entityId order для active-task/AI lane, max one query/entity/tick и stop-before-blocked-cell при exhausted active-task budget; Team/Health/combat, generic Objective, Soldier behavior, Tower/garrison/ejection, PvE/STALLED, wave/WAVE_CLEARED/DEFEAT и repeatability.

### MatchRuntime / Local-Remote parity

- same setup/commands/ticks → equivalent gameplay snapshot;
- same invalid command → same machine-readable rejection;
- runtime drains events every tick;
- remote simulation rejection не теряется;
- enqueue → Controller loss before apply → rejection;
- permanent leave/timeout → pending queue этого player очищена, commands никогда не применяются и stale rejection events не создаются;
- reconnect-grace disconnect не очищает pending queue преждевременно;
- one MatchSnapshot per tick then recipient projections.

### Server integration / security

- invalid ownership/control rejected;
- malformed message does not crash room;
- bounded commandId/entityIds/identifiers;
- bounded `maxPendingCommandsPerPlayer` + `queue_full`;
- explicit room message-rate limit;
- one-player spam cannot unboundedly delay another player's queued command;
- new joins locked after START, reserved reconnect still works;
- economy/combat/wave remain authoritative.

### Client/presentation

- player color independent from transient Controller;
- WORLD↔CONTAINED resets interpolation history;
- one path owns per-frame mesh transforms;
- map bounds from mapId + game-data;
- wave countdown derives seconds from replicated `tickRateHz`, без hardcoded 10 Hz.

### Browser E2E

Local + Remote full-flow smoke. Проверить `WAVE_CLEARED + RUNNING` и `DEFEAT + FINISHED`. Test timing можно ускорить при неизменных rules.

## 28. Definition of Done

Playable flow: start → gather Wood → build Wall/Tower → Soldier/garrison → warning → PvE wave → WAVE_CLEARED/RUNNING либо Sacred Site destroyed → FINISHED/DEFEAT.

Дополнительно:

- one shared MatchRuntime;
- H1–H4 #53 закрыты regressions;
- rate/size/join-after-start hardening;
- generic Objective не hardcode Sacred Site;
- deterministic bounded pathfinding;
- physical construction and routing Walls;
- Tower base + garrison profile;
- player color не следует transient Controller;
- one snapshot/tick + recipient full GameStateView;
- representative Babylon Art Direction target normal/strategic zoom;
- Foundation regressions + CI green.

## 29. Final implementation graph

Архитектурные stages остаются G0–G14. Для правила `1 issue = 1 reviewable PR` два крупных logical stages разделены на implementation sub-stages:

- G4 → G4a navigation, G4b fair scheduling/budgets, G4c breach-aware planner;
- G12 → G12a presentation invariants, G12b gameplay interactions, G12c HUD/state feedback.

Это **implementation decomposition**, а не изменение gameplay architecture: требования исходных G4/G12 остаются распределены между дочерними issues.

Актуальный dependency graph:

```text
G0  Architecture/docs finalization — merged PR #52
 ▼
#54 G1  Shared MatchRuntime / Foundation host hardening
 ├──────────────────┐
 ▼                  ▼
#55 G2             #56 G3
Session/input      Entity/Objective/Map
                      │
                      ▼
                   #57 G4a
                   Navigation / MOVE core
                      │
                 ┌────┴────┐
                 ▼         ▼
              #68 G4b   #69 G4c
              Fair      Breach-aware
              scheduler planner
                 │
            ┌────┴────┐
            ▼         ▼
         #58 G5     #59 G6
         Economy    Combat / Teams / Soldier
            └────┬────┘
                 ▼
              #60 G7 Construction / Wall / Tower
              ┌──┴─────────────────┐
              ▼                    ▼
           #61 G8               #62 G9
           Garrison             PvE AI
                                (also needs #69)
                                   │
                                   ▼
                                #63 G10 Wave / Defeat
              #61 ─────────────────┤
                                   ▼
                                #64 G11 Protocol / Replication
                                   ▼
                                #65 G12a Presentation cleanup
                                   ▼
                                #70 G12b Interaction controls
                                   ▼
                                #71 G12c HUD / state feedback
                                   ▼
                                #66 G13 Representative Art Direction target
                                   ▼
                                #67 G14 Full Local/Remote E2E
                                   ▼
                                #002 DONE
```

Dependency/parallelism rules:

- after G1/#54: G2/#55 and G3/#56 may run independently;
- G4a/#57 depends on G3/#56;
- after G4a/#57: G4b/#68 and G4c/#69 may run in parallel; G4b also consumes G2/#55 policy/caps;
- after G4b/#68: G5/#58 and G6/#59 may run in parallel;
- G9/#62 requires both G7/#60 and G4c/#69;
- G11/#64 waits for G8/#61 and G10/#63;
- G12a → G12b → G12c are intentionally sequential because they share one client/presentation surface.

G1 closes shared host/event drain/tick validation, per-player queue **structure** and permanent-leave pending-queue cleanup. G2 owns ingress caps, `maxPendingCommandsPerPlayer`, `queue_full`, rate/size hardening and room lock. G4b owns deterministic fair round-robin and path budgets. Эти boundaries нельзя схлопывать обратно в один ранний PR.

LOBBY/join/reconnect/room-lock lifecycle остаётся shell-owned согласно ADR-009. Shared MatchRuntime объединяет gameplay bootstrap/execution/projection, а Local/Remote обязаны иметь одинаковые observable `START → RUNNING → FINISHED` gameplay semantics без общего session manager.

Практический максимум — **2 Coding Agents одновременно**.

Каждый implementation issue в этом graph обязан содержать **Required reading** с конкретными разделами этой Spec и ADR, а не только общей ссылкой на документ. Issue повторяет локальные acceptance criteria, но не дублирует и не переопределяет архитектурный contract.

## 30. Architecture review conclusion

Architecture pass завершён и reconciled с merged Art Direction #48/#49 и audit #53.

Сохраняются approved решения: continuous world + grid, deterministic navigation/breach planning, generic garrison, Owner/Controller/Team separation, tick-boundary validation, projection-oriented GameStateView, shared MatchRuntime, `@web-rts/match-adapter`, declarative game-data.

Дополнительно зафиксированы generic Objective vs Sacred Site identity, stable player-color semantics, event drain/parity, rate+size limits, room lock, full GameTransport session boundary, one MatchSnapshot/tick + full recipient GameStateView, bounded per-player command queues + deterministic fair round-robin, starvation-free separated pathfinding budgets с entityId lane ordering, resumable same-owner Construction Site с immediate builder reservation, replicated tickRateHz и representative Babylon target.

PR #52 уже merged, architecture gate пройден. Implementation идёт через epic #50 и child issues #54–#71 по graph из §29; каждый issue проходит Task Chat → Coding Agent → PR → independent review → user manual merge.

Issue #53 остаётся audit record / verification tracker. Его исходные рекомендации сохраняются как historical snapshot; при расхождении текущий contract задают accepted Spec/ADR и соответствующий child issue.
