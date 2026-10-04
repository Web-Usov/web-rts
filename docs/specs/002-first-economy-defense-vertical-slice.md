# Gameplay Spec #002 — First Economy & Defense Vertical Slice

Статус: **DRAFT / architecture review pending**  
Дата: **2026-10-03**  
Проект: **Web RTS**  
Tracking issue: **#50**

> Этот документ намеренно фиксирует уже принятые продуктовые решения до завершения архитектурного review.
> Он не является разрешением начинать implementation. До снятия DRAFT должны быть проверены grid/navigation,
> blocker selection, garrison, team/hostility и protocol/replication contracts.

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
- `docs/technical-vision.md`;
- Foundation Spec #001;
- ADR-001 — authoritative server and shared simulation;
- ADR-002 — Babylon.js renderer;
- ADR-003 — Colyseus multiplayer layer;
- ADR-004 — fixed timestep and repeatable simulation;
- ADR-005 — data-oriented entity model;
- ADR-006 — local vs remote GameTransport;
- ADR-007 — replication boundary and visibility.

Ожидается отдельное архитектурное решение по grid/occupancy/navigation (рабочее обозначение: **ADR-008**),
но его финальная форма должна быть определена архитектурным review этого draft.

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
- production graphics/audio.

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

Command queue / Shift-orders в #002 отсутствуют.

Если доступного drop-off нет, Worker не может завершить deposit loop и не создаёт ресурсы из ничего.

## 11. Construction

Intent:

```text
BUILD
builderEntityId
buildingType
targetCell
```

Simulation валидирует минимум:

- controller/ownership permission;
- building type;
- Wood availability;
- footprint;
- buildable cells;
- occupancy;
- возможность Worker добраться до build position/range.

После принятия BUILD:

```text
Wood списывается
→ создаётся building entity
→ state = UNDER_CONSTRUCTION
→ footprint сразу занимает grid
→ Worker идёт к build range
→ progress растёт по simulation ticks
→ state = COMPLETED
```

Если Worker получает другую задачу:

- building остаётся;
- progress сохраняется;
- construction pauses.

Модель не должна навечно связывать construction с одним Worker: другой допустимый Worker должен архитектурно иметь возможность продолжить стройку.

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

Replication/view shape для non-spatial living entities определяется отдельным architecture pass.

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

Client должен иметь возможность узнать:

```text
Soldier:
  containedIn = Tower #N
  position = null

Tower:
  occupant relation visible/derivable
```

Presentation не рисует отдельный world mesh entity без Position, но entity остаётся доступной для UI/state.

Конкретная protocol/view representation определяется отдельным replication architecture pass.

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
Objective  = SACRED_SITE
```

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

## 21. Sacred Site / defeat

Sacred Site становится destructible objective с Health.

Если:

```text
Sacred Site health <= 0
```

то:

```text
phase = FINISHED
result = DEFEAT
```

Это единственное match-ending condition #002.

Victory condition отсутствует.

## 22. Protocol / command validation — APPROVED

Статус архитектурного решения: **APPROVED 2026-10-04**.

### 22.1 Validation layers

Untrusted client payload проходит три разных уровня:

```text
unknown payload
→ protocol/schema validation
→ typed GameCommand
→ session/transport validation
→ trusted actor context + command
→ simulation queue
→ gameplay semantic validation at tick boundary
→ apply / reject
```

Transport/application boundary отвечает за schema/session/match-phase/transport limits.

Simulation отвечает за gameplay semantics:

- Controller permission;
- entity existence/state;
- resource availability;
- placement;
- path/reachability;
- garrison conditions;
- другие gameplay rules.

Gameplay validation не должна дублироваться отдельными Local и Remote implementations.

### 22.2 Semantic validation happens on tick boundary

Команда не должна считаться gameplay-valid только потому, что была valid в момент network receive.

Host после schema/session checks enqueue'ит trusted command. На simulation tick команды обрабатываются FIFO и каждая проверяется против **текущего world state**, уже учитывающего предыдущие команды этого же tick.

Пример конфликтов:

```text
BUILD A cell X → accepted, occupancy changes
BUILD B cell X → rejected: invalid_placement

Wood = 100
BUILD A cost 80 → accepted, Wood = 20
BUILD B cost 80 → rejected: insufficient_resources
```

Gameplay mutation одной применяемой команды должна быть atomic относительно command application.

### 22.3 Trusted actor context

Public GameCommand не содержит authoritative identity:

- playerId;
- teamId;
- ownerId;
- session identity.

Remote host выводит PlayerId из server session/slot.
Local host назначает Local PlayerId внутри trusted local runtime.

В simulation queue actor context отделён от gameplay intent концептуально:

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
buildingTypeId
anchorCell { x, y }
```

BUILD использует grid anchor, потому что placement/grid occupancy являются gameplay contract.

`buildingTypeId` — bounded data identifier, а не обязательный protocol enum для каждого будущего building definition.
Simulation валидирует, существует ли definition и разрешён ли он в текущем game mode/slice.

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

Authoritative order #002 — FIFO order trusted commands в simulation queue.

При одинаковой последовательности queued commands simulation должна давать одинаковый result.

Replay/deduplication protocol поверх `clientSequence` находится вне #002.

### 22.6 Command rejection vs later task failure

Нужно различать два lifecycle.

#### COMMAND_REJECTED

Команда не начала gameplay action.

Примеры stable machine-readable reasons:

```text
invalid_schema
not_running
not_controller
entity_not_found
entity_not_spatial
blocked_target
insufficient_resources
invalid_placement
no_path
no_garrison_slot
no_exit
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

### 22.7 BUILD atomicity

BUILD применяется только если на tick одновременно валидны минимум:

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
        shared gameplay command queue
                  ↓
              World.step
                  ↓
       semantic gameplay validation
                  ↓
             systems/tasks
```

Точное shared host/runtime размещение определяется отдельным Local/Remote architecture pass.

Breaking wire changes требуют `PROTOCOL_VERSION` bump по существующему contract.


## 23. Replication — draft

Client получает view/projection, а не simulation World.

Минимально UI/presentation потребуется состояние для:

- entity kind/type;
- Health;
- building state;
- construction progress;
- ResourceNode state;
- Worker task при необходимости UI;
- player Wood;
- garrison relation/state;
- active Tower combat profile при необходимости presentation;
- wave state;
- match result.

Fog filtering в #002 отсутствует.

> **Architecture review:** определить, какие поля действительно являются stable public view contract,
> а какие можно оставить локальной projection detail, чтобы не раздувать protocol без необходимости.

## 24. Presentation / UI minimum

Developer art допустим.

#002 должен быть играем без Inspector/debug console.

Минимум:

- Wood counter;
- Worker selection;
- GATHER interaction;
- BUILD Wall/Tower;
- placement valid/invalid feedback;
- construction progress;
- Soldier selection + MOVE;
- GARRISON / UNGARRISON interaction;
- basic HP feedback;
- wave warning/state;
- WAVE_CLEARED indication;
- DEFEAT state.

React по-прежнему не хранит per-frame entity transforms.

## 25. Determinism

Обязательны:

- fixed timestep;
- seeded RNG;
- no gameplay `Math.random()`;
- no simulation wall-clock;
- deterministic A* tie-breaking;
- deterministic target tie-breaking;
- deterministic blocker selection;
- deterministic garrison ejection;
- stable processing order.

Для одинаковых:

```text
seed
map
commands
```

simulation scenario должен давать одинаковый gameplay result.

## 26. Local vs Remote

Ключевой #002 scenario должен работать через:

```text
LocalGameTransport
→ WebWorker
→ shared simulation
```

и:

```text
RemoteGameTransport
→ Colyseus
→ authoritative server
→ shared simulation
```

Local path не получает упрощённые economy/combat/wave rules.

Foundation multiplayer/reconnect/browser regression должны сохраняться.

## 27. Automated testing direction

### Simulation

Нужны tests/scenarios для:

- ResourceNode depletion;
- Worker gather → carry → deposit;
- Worker IDLE after depletion;
- BUILD validation;
- resource spending;
- construction pause/resume;
- footprint occupancy;
- deterministic A*;
- path invalidation/replan;
- Wall blocking;
- Health/damage/death;
- hostility;
- Soldier aggro/chase;
- target stickiness;
- explicit MOVE overrides combat;
- Tower automatic attack;
- Tower profile change after garrison;
- garrison/ungarrison;
- Tower destruction ejection;
- enemy objective pathing;
- enemy breaks blocked path;
- wave lifecycle;
- WAVE_CLEARED;
- Sacred Site destruction → DEFEAT;
- repeatability.

### Server integration

Минимально:

- invalid ownership commands rejected;
- insufficient Wood rejected;
- invalid placement rejected;
- economy authority;
- combat authority;
- wave progresses without client authority;
- malformed gameplay messages do not crash room.

### Browser E2E

Нужен Local gameplay smoke и Remote authoritative gameplay smoke.

Browser E2E не обязан ждать реальные 5–10 минут: test data/timing допускается ускорить,
если gameplay rules остаются теми же.

## 28. Definition of Done — draft

#002 может считаться завершённым, когда player-visible flow позволяет:

```text
start
→ gather Wood
→ build Wall
→ build Tower
→ position Soldier / garrison
→ receive wave warning
→ fight PvE wave
```

и получить:

```text
WAVE_CLEARED + Match still RUNNING
```

либо:

```text
Sacred Site destroyed
→ FINISHED / DEFEAT
```

При этом:

- Local и Remote используют одну simulation;
- remote multiplayer остаётся server-authoritative;
- pathfinding deterministic;
- Walls реально влияют на routing;
- construction физическое и tick-based;
- Tower работает без Soldier и меняет style при garrison;
- Foundation regression green;
- CI green;
- premature optimization не вводится.

## 29. Предварительный implementation graph

Это **не финальная issue breakdown** до архитектурного review.

```text
G0  Spec #002 + architecture decisions / ADR
 │
G1  Grid / fixed map / occupancy
 │
G2  Deterministic A* + path-follow movement
 │
 ├───────────────┐
 ↓               ↓
G3 Economy       G5 Combat foundation
Worker/Gather    Health/Teams/Soldier
 │               │
 ↓               │
G4 Construction  │
Walls            │
 │               │
 └───────┬───────┘
         ↓
    G6 Tower + Garrison
         │
         ↓
    G7 PvE AI
         │
         ↓
    G8 Wave + Sacred Site defeat
         │
         ↓
    G9 Gameplay browser E2E
         │
         ↓
      #002 DONE
```

После G2 Economy и Combat foundation потенциально могут идти параллельно,
если архитектурный review подтвердит отсутствие конфликтующего shared surface.

## 30. Обязательный следующий architecture review

Общий tracking issue #50 остаётся **DRAFT** до завершения всего review.

### Уже одобрено

- [x] continuous world + discrete navigation/build grid;
- [x] game-wide spatial scale: 1 cell = 1 simulation world unit для #002;
- [x] half-open grid-derived map bounds;
- [x] declarative MapDefinition в game-data, runtime spatial logic в simulation;
- [x] generic solid footprint occupancy;
- [x] units не являются A* blockers в #002;
- [x] BUILD запрещён поверх текущей unit cell;
- [x] Construction Site блокирует клетки с tick принятия BUILD;
- [x] occupancy/navigation обновляются до movement;
- [x] MOVE остаётся world-space intent;
- [x] intermediate cell-center waypoints + exact final MOVE target;
- [x] blocked direct MOVE target отклоняется;
- [x] navigation поддерживает approach goal sets;
- [x] deterministic 4-neighbor A* + Manhattan + stable tie-breaking;
- [x] lazy replan при invalid next waypoint;
- [x] continuous movement остаётся отдельным нижним слоем;
- [x] presentation не владеет отдельным hardcoded gameplay map size;
- [x] normal A* имеет приоритет перед breach planning;
- [x] breach-aware route минимизирует `(breachCount, pathLength, deterministicTieBreak)`;
- [x] breach считается по solid occupant entity, а не по footprint cells;
- [x] blocker target — первый breachable entity на выбранном route;
- [x] blocker attack использует обычные approach goal cells;
- [x] blocker target stickiness сохраняется до invalidation/destruction;
- [x] после destruction objective path вычисляется заново;
- [x] enemies могут независимо focus один blocker;
- [x] impossible route даёт STALLED, без teleport/non-breachable destruction;
- [x] retry после полного failure привязан к topology revision;
- [x] map invariant требует baseline spawn→Sacred Site route без player fortifications;
- [x] garrison моделируется generic `GarrisonHost` + authoritative occupant-side `ContainedIn` relation;
- [x] occupants derived from `ContainedIn`, без дублируемой mutable relation;
- [x] contained entity остаётся living, но не имеет `Position`;
- [x] Owner/Controller/Health сохраняются при garrison;
- [x] GARRISON — task с физическим approach и повторной validation, не teleport;
- [x] UNGARRISON выбирает deterministic valid exit, при отсутствии exit отклоняется;
- [x] host destruction сначала снимает occupancy и deterministic eject'ит occupant;
- [x] contained occupant не является отдельной combat target в #002;
- [x] Tower combat profile derived data-driven из host + occupant capability;
- [x] snapshot/replication обязаны поддержать living entity без Position;
- [x] Owner / Controller / Team — независимые concepts;
- [x] Team хранится entity-level, Player→Team assignment — match-level;
- [x] hostility не определяется через разные `teamId`;
- [x] relationship resolver возвращает FRIENDLY / NEUTRAL / HOSTILE;
- [x] relationship policy является match-level и симметрична в #002;
- [x] entities без Team считаются neutral;
- [x] combat использует hostility отдельно от targetability/destructibility;
- [x] Sacred Site имеет shared player Team без Owner/Controller;
- [x] PvE имеет отдельную Team без Owner/Controller;
- [x] disconnect/control transfer/garrison не меняют Team автоматически;
- [x] protocol/schema/session validation отделены от gameplay semantic validation;
- [x] gameplay validation выполняется на simulation tick boundary;
- [x] trusted PlayerId выводится host'ом и не приходит в client payload;
- [x] public command set #002: MOVE / GATHER / BUILD / GARRISON / UNGARRISON;
- [x] MOVE world-space, BUILD grid-anchored, interactions ссылаются на entity IDs;
- [x] simulation command queue FIFO; clientSequence не задаёт gameplay ordering;
- [x] COMMAND_REJECTED отделён от позднего ACTION_FAILED;
- [x] BUILD application atomic относительно resources/entity/occupancy/task;
- [x] GATHER/GARRISON поддерживают повторную validation на момент interaction;
- [x] schemas strict и bounded; client отправляет только intent;
- [x] failure reasons machine-readable;
- [x] Local/Remote должны сходиться в shared gameplay command-validation path.

Этот блок является основой будущего **ADR-008: Grid, occupancy and deterministic navigation**.

### Ещё требуется review

1. replication/view contract;
2. shared Local/Remote host abstractions;
3. package boundaries после добавления gameplay systems;
4. финальная dependency graph и безопасная параллельная issue breakdown.

До завершения этих пунктов tracking issue #50 остаётся **DRAFT**, ADR-008 не считается финализированным, а implementation issues не запускаются.
