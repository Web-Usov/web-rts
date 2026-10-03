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

## 7. Spatial/Grid contract — draft

Фиксированная карта получает logical navigation/build grid.

Каждая cell концептуально имеет:

```text
walkable
buildable
static terrain
building occupancy
```

Grid — simulation abstraction; визуально игра не обязана выглядеть тайловой.

World ↔ grid coordinate mapping должен быть deterministic.

Для #002 navigation graph использует только:

```text
N / S / E / W
```

Диагональный pathfinding не входит в scope.

### Building occupancy

Building footprint занимает grid cells.

Начальные footprints:

```text
Wall  = 1x1
Tower = 1x1
```

Town Hall и Sacred Site могут иметь отдельные configurable footprints.

Construction site блокирует navigation сразу после принятия BUILD.

Placement запрещён:

- вне карты;
- на non-buildable terrain;
- поверх building footprint;
- поверх текущей позиции unit.

Moving units не считаются permanent navigation obstacles.

> **Architecture review:** нужно окончательно определить semantics временной unit occupancy,
> world/grid mapping, path execution между cell centers и interaction нескольких moving units.

## 8. Navigation — draft

Используется deterministic A*.

Требование:

```text
same world state + same command
→ same chosen path
```

Tie-breaking должен быть стабильным.

Path должен пересчитываться, если building occupancy делает текущий маршрут недействительным.

### Полностью заблокированный путь

Если PvE enemy не может построить путь к Sacred Site, он должен выбрать доступное hostile building,
разрушение которого позволяет продолжить objective path:

```text
Sacred Site unreachable
→ choose blocking building
→ path to attack position
→ destroy
→ retry Sacred Site path
```

При равных кандидатах выбор deterministic.

> **Architecture review:** требуется формально определить blocker-selection algorithm.
> Нельзя оставлять это как эвристику, которую разные implementation tasks поймут по-разному.

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

## 15. Garrison — draft

Добавляются intents:

```text
GARRISON
UNGARRISON
```

Soldier должен физически добраться до Tower до входа.

После garrison:

- Soldier остаётся gameplay entity;
- Owner/Controller сохраняются;
- Soldier не pathfind'ится и не атакует как отдельный world unit;
- Tower получает occupant relation;
- combat profile Tower меняется согласно occupant capability.

После UNGARRISON Soldier появляется на deterministic valid cell рядом с Tower.

Если Tower уничтожена, occupant deterministic eject'ится на ближайшую допустимую cell.

В #002 Soldier при уничтожении Tower не погибает автоматически и не получает дополнительный damage.

> **Architecture review:** representation должна быть generic и не превращаться в hardcoded
> `if Tower + Soldier`. Нужно определить relation/component и capability/data contract.

## 16. Teams / hostility — draft

Hostility нельзя определять через:

```ts
playerId !== otherPlayerId
```

Нужен минимальный team/faction concept, который допускает:

```text
несколько игроков одной команды
PvE hostile faction
будущие PvP teams
```

Friendly fire в #002 отсутствует.

> **Architecture review:** определить минимальную representation, не создавая преждевременную diplomacy system.

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

Если путь к Sacred Site невозможен, применяется blocker behavior из navigation contract.

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

## 22. Protocol — draft

Существующий `MOVE` сохраняется.

Рабочий набор новых gameplay intents:

```text
GATHER
BUILD
GARRISON
UNGARRISON
```

Отдельный ATTACK в #002 не требуется: Soldier/Tower/PvE combat automatic.

Client не является authority для:

- player identity;
- resource amount;
- construction progress;
- path result;
- damage;
- death;
- target selection;
- wave progression;
- match result.

При breaking wire changes увеличивается `PROTOCOL_VERSION`.

> **Architecture review:** окончательно определить payload schemas, command ownership checks,
> rate/size validation и какие gameplay interactions выражаются explicit command, а какие — server/simulation behavior.

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

Перед созданием implementation issues необходимо пройти документ минимум по следующим вопросам:

1. world/grid coordinate model;
2. static vs dynamic occupancy;
3. movement semantics нескольких units;
4. deterministic A* и replan;
5. blocker-selection algorithm;
6. generic garrison representation;
7. team/hostility representation;
8. command schemas и validation;
9. replication/view contract;
10. shared Local/Remote host abstractions;
11. package boundaries;
12. безопасная параллельная issue breakdown.

До завершения этого review tracking issue #50 остаётся **DRAFT**.
