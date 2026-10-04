# Technical Vision v0.1

Статус: **Proposed / ready for ADR breakdown**  
Дата: **2026-09-24**  
Проект: **Web RTS**

Этот документ фиксирует целевую техническую архитектуру первой версии Web RTS. Он развивает [`technical-direction.md`](./technical-direction.md) и конкретизирует решения, которые ранее были оставлены как TBD.

Если `technical-direction.md` и этот документ расходятся, приоритет имеет **Technical Vision v0.1**.

---

## 1. Цель технической архитектуры

Нужно получить браузерную RTS до 4 игроков, которую можно последовательно развить от простого локального прототипа до публичного multiplayer без переписывания ядра игры.

Главные технические свойства:

- одна общая simulation для Solo, Coop и PvP/PvPvE;
- authoritative multiplayer server;
- независимость игровых правил от renderer, network и UI;
- простая первая реализация без преждевременной инфраструктуры;
- достаточная модульность для дальнейшего масштабирования;
- возможность автоматизированной разработки через coding agents;
- высокая тестируемость simulation и multiplayer;
- возможность оптимизировать rendering, replication и pathfinding по результатам измерений, а не заранее.

---

## 2. Не-цели первой технической версии

На фундаментальном этапе намеренно не строим:

- аккаунты пользователей;
- persistent progression;
- рейтинг и matchmaking service;
- PostgreSQL/Redis;
- микросервисы;
- Kubernetes;
- event bus;
- сложный бинарный протокол;
- rollback netcode;
- lockstep networking;
- полноценный anti-cheat;
- процедурную генерацию карты;
- map editor;
- production cluster.

Если одна из этих вещей понадобится позже, она должна появиться из конкретного use case и отдельного ADR/spec.

---

## 3. Зафиксированный стек

| Область | Решение |
|---|---|
| Language | TypeScript |
| Runtime server | Node.js LTS |
| Package manager | pnpm workspaces |
| Monorepo task orchestration | Turborepo |
| Client build | Vite |
| Web UI | React |
| 3D renderer | Babylon.js |
| Multiplayer framework | Colyseus |
| Multiplayer transport | WebSocket через Colyseus |
| Simulation | собственный framework-agnostic TypeScript package |
| Unit/integration tests | Vitest |
| Browser E2E | Playwright |
| Runtime command validation | Zod или эквивалентная schema validation library; первая реализация — Zod |
| Local containerization | Docker / Docker Compose |
| CI | GitHub Actions |

`pnpm` отвечает за package/workspace management. `Turborepo` используется поверх него для task graph, orchestration, dependency-aware execution и local task cache. Подробности зафиксированы в [`ADR-000`](./adr/000-pnpm-turborepo-monorepo.md).

Версии зависимостей не фиксируются в этом документе. Они должны быть закреплены lockfile в момент scaffold проекта.

---

## 4. Почему Babylon.js

Основной renderer — **Babylon.js**.

Причины выбора для этого проекта:

- игра изначально ориентирована на stylized low-poly 3D;
- есть полноценная scene/camera/asset abstraction;
- есть Inspector для runtime debugging;
- встроена поддержка hardware instancing и thin instances;
- WebGL и WebGPU находятся в рамках одного engine API;
- меньше собственного rendering glue, чем при использовании более низкоуровневой библиотеки;
- это снижает объём инфраструктурного кода, который coding agents должны поддерживать.

Three.js остаётся хорошей библиотекой, но для Web RTS предпочтение отдаётся Babylon.js как более game-oriented foundation.

### Rendering backend

Код игры не должен зависеть от уникальных возможностей только одного graphics backend без необходимости.

Предпочтительная инициализация:

```text
WebGPU, если поддерживается и стабилен в окружении
          ↓ fallback
WebGL
```

CI не должен зависеть от наличия WebGPU на runner.

---

## 5. Target architecture

```text
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                │
│   React UI                 Babylon Presentation                 │
│      │                            │                             │
│      └──────────────┬─────────────┘                             │
│                     │                                           │
│              Client Game State                                  │
│                     │                                           │
│               GameTransport                                     │
│              /             \                                    │
│   LocalGameTransport      RemoteGameTransport                   │
│        │                       │                                 │
│   WebWorker shell           Colyseus SDK                        │
└───────┼───────────────────────┼─────────────────────────────────┘
        │                       │ WebSocket
        │                       ▼
        │                Colyseus Room shell
        │                       │
        └──────────┬────────────┘
                   │ typed GameCommand / session context
                   ▼
          @web-rts/match-adapter
                   │
                   ▼
               MatchRuntime
          (@web-rts/simulation)
                   │
       ┌───────────┼────────────┐
       │           │            │
     rules      AI/waves    navigation
       │           │            │
       └───────────┴────────────┘
                   │
           MatchSnapshot/events
                   │
                   ▼
          @web-rts/match-adapter
                   │
                   ▼
      GameStateView / GameEvent
```

Критическое правило:

> **MatchRuntime / Simulation Core — единственный источник истины для gameplay rules и authoritative match state.**

Local WebWorker и Remote Colyseus Room — session/scheduler/transport shells. Они не содержат самостоятельных gameplay validators/projection rules.

Babylon.js, React и Colyseus не содержат самостоятельной бизнес-логики игры.

---

## 6. Структура monorepo

Структура остаётся компактной, но после Foundation добавляется один bridge package для общей Local/Remote integration boundary.

```text
apps/
  web/
  game-server/

packages/
  simulation/
  protocol/
  game-data/
  match-adapter/
  testkit/

tools/
  bot-client/
  scenario-runner/
```

Monorepo по-прежнему использует `pnpm workspaces + Turborepo`. Корневые `pnpm dev/build/test/typecheck/lint` остаются единым interface для человека, CI и agents; runtime-код игры от Turborepo не зависит.

`apps/web`: React UI, Babylon presentation, ClientGameState, input/selection/interpolation, Local/Remote GameTransport. Local WebWorker остаётся session/scheduler shell и не владеет отдельными gameplay rules/projection.

`apps/game-server`: Colyseus Room/session/reconnect, room lock/rate limit, tick scheduler, logs и lifecycle shared MatchRuntime. Server app не владеет отдельными gameplay validators и не читает World stores для production gameplay decisions.

`packages/simulation`: framework-agnostic gameplay truth — MatchRuntime, world/components, command queue + tick-boundary semantic validation, navigation/economy/construction/combat/teams/objectives/garrison/AI/waves, RNG, transport-neutral snapshot/events/metrics. Не импортирует renderer/network framework/DOM/Node/`@web-rts/protocol`.

`packages/protocol`: wire/client contracts — GameCommand/GameEvent/GameStateView, GameTransport, versions и runtime parse schemas. Не импортирует simulation.

`packages/game-data`: typed/versioned declarative definitions и balance/map data; gameplay algorithms здесь не живут.

`packages/match-adapter`: единственная bridge boundary между protocol и simulation:

```text
GameCommand → SimulationCommand
MatchSnapshot + recipient/session context → GameStateView
RuntimeEvent → GameEvent
```

Package не хранит authoritative gameplay state и не выполняет semantic gameplay validation.

`packages/testkit`: builders/fixtures/scenario/parity helpers; production code от него не зависит.

Не создаём package для каждого gameplay понятия заранее. `ai`, `map`, `pathfinding`, `combat`, `economy` остаются внутри simulation до реального use case.

---

## 7. Simulation model

Simulation строится как **data-oriented, system-driven model**, но без обязательного использования стороннего ECS framework на старте.

Предпочтительная модель:

```text
World
 ├─ entity registry
 ├─ component stores
 ├─ game systems
 ├─ command queue
 ├─ event queue
 ├─ RNG
 └─ tick counter
```

### Entity ID

Для hot-path entities используются компактные numeric IDs, например `uint32`-совместимые значения.

Не использовать UUID как основной идентификатор тысяч runtime entities.

### Components

Компоненты — простые данные.

Например:

```ts
Position
Health
Movement
Combat
Owner
Controller
Building
Objective
ResourceNode
```

### Systems

Системы содержат поведение:

```text
MovementSystem
CombatSystem
EconomySystem
ConstructionSystem
ObjectiveSystem
VisibilitySystem
WaveSystem
```

Не строим глубокую иерархию классов вида:

```text
Entity -> Unit -> Human -> Soldier -> Archer
```

Композиция данных предпочтительнее наследования.

---

## 8. Fixed timestep

Начальная simulation frequency:

**10 ticks/sec**

То есть:

```text
simulation tick = 100 ms
```

Client renderer работает независимо, обычно через browser animation loop (~60 FPS на подходящем устройстве).

### Почему 10 Hz

Для RTS это даёт:

- достаточную отзывчивость для команд высокого уровня;
- больший CPU budget на AI/pathfinding;
- умеренный сетевой трафик;
- простую первую реализацию.

Это не вечный контракт. Tick rate должен быть конфигурируемым и может быть изменён после profiling.

### Tick rules

Simulation не должна читать реальное время напрямую.

Запрещается использовать в игровых правилах:

- `Date.now()`;
- `performance.now()`;
- `setTimeout()`;
- `Math.random()`.

Игровое время определяется номером tick и simulation config.

---

## 9. Determinism

Нам **не нужен cross-platform deterministic lockstep**.

Server authoritative модель означает, что только сервер определяет истинное состояние multiplayer матча.

Но simulation должна быть максимально повторяемой для:

- tests;
- scenario runner;
- debugging;
- будущих replays.

Для этого:

- используется seeded RNG abstraction;
- command ordering явный;
- simulation не зависит от wall clock;
- одинаковый seed + initial state + commands должны давать одинаковый результат в одинаковом runtime/version.

Floating point разрешён.

Не вводим fixed-point arithmetic без доказанной необходимости.

---

## 10. Command processing

Клиент отправляет **intent**, а не новое состояние.

Wire command содержит `type`, `commandId`, `clientSequence` и command-specific intent, но **не authoritative player identity**.

Remote server выводит trusted `PlayerId` из session/slot. Local runtime назначает trusted local PlayerId.

```text
untrusted payload
→ strict/bounded schema validation
→ session/phase/rate checks
→ trusted actor + typed command
→ shared MatchRuntime admission
   ├─ bounded per-player FIFO queue
   └─ queue_full on overflow
→ deterministic fair scheduler
→ semantic gameplay validation at simulation tick boundary
→ apply or COMMAND_REJECTED
```

Command ingress shared для Local/Remote:

- `maxPendingCommandsPerPlayer` ограничивает memory per player;
- `maxCommandsPerTick` ограничивает command processing work;
- внутри player сохраняется FIFO;
- между players используется deterministic round-robin с persistent cursor;
- raw packet arrival order между разными players не определяет gameplay winner;
- path-heavy commands расходуют command path budget по approved Spec/ADR-008.

Gameplay permissions/control, costs, placement, reachability и entity state проверяются shared simulation против текущего world state на tick boundary.

`queue_full` является admission/backpressure rejection до semantic validation. Long-running task может позже получить `ACTION_FAILED`, если world изменился; это не retroactive rejection.

Client никогда не сообщает authoritative HP/resources/team/damage/construction/path/final position.

---

## 11. Protocol versioning

Даже в MVP протокол имеет версию.

Например:

```text
protocolVersion = 1
```

При несовместимой версии client/server соединение отклоняется понятной ошибкой.

Также отдельно существует:

```text
gameDataVersion
```

Это пригодится, когда клиентские assets/config и серверные правила могут оказаться разных версий.

---

## 12. Multiplayer server: Colyseus

Colyseus используется для:

- Room lifecycle;
- WebSocket transport;
- join/create room;
- client sessions;
- reconnect;
- room lock / input-rate enforcement;
- delivery of protocol messages;
- будущего lobby/matchmaking при необходимости.

Colyseus Room **не является simulation** и не владеет gameplay semantic validation.

Target flow:

```text
Colyseus Room shell
     │
     ├─ connections / session lifecycle
     ├─ strict schema / phase / rate checks
     ├─ derive trusted PlayerId
     │
     ▼
@web-rts/match-adapter
     │ GameCommand → SimulationCommand
     ▼
MatchRuntime
     │
     ├─ tick-boundary gameplay validation
     ├─ authoritative systems
     └─ MatchSnapshot / RuntimeEvents
     │
     ▼
@web-rts/match-adapter
     │ recipient projection / event mapping
     ▼
GameStateView / GameEvent messages
     │
     ▼
Colyseus transport
```

Для текущего gameplay stage full `GameStateView` messages являются baseline. Colyseus Schema/delta transport остаются optimization option после profiling и не определяют simulation structure.

Это позволяет менять strategy serialization/replication без переписывания gameplay rules.

---

## 13. State replication

Simulation state и replicated state — **разные структуры**.

Current gameplay-stage strategy:

```text
MatchRuntime
→ one transport-neutral MatchSnapshot per simulation tick
→ per-recipient projection
→ full GameStateView message
→ GameTransport / ClientGameState
```

Full snapshots — простой baseline. Colyseus Schema/state synchronization, deltas, dirty masks, binary encoding и lower patch rate остаются допустимыми optimizations после profiling и не определяют simulation model.

Persistent view содержит только нужную client/presentation информацию. Top-level view включает authoritative `tick` и effective immutable `tickRateHz`, чтобы UI не hardcode'ил simulation frequency при countdown/timing presentation.

One-shot messages/events используются для command rejection, async action failure и transient notices/VFX hints.

Per-recipient visibility остаётся server-owned policy: hidden gameplay-sensitive state не отправляется client только ради renderer-side hiding.

Стартово state view публикуется до 10 updates/sec, синхронно с simulation tick. Frequency/serialization strategy может меняться отдельно после measurement.

---

## 14. Client interpolation

Первая multiplayer версия **не использует movement prediction** для армии.

Клиент хранит минимум два полученных состояния transform и интерполирует presentation между ними.

```text
server states:       A -------- B -------- C
rendered position:      smooth interpolation
```

Локальный UI реагирует мгновенно:

- selection;
- drag box;
- destination marker;
- command feedback.

Но реальное движение entity определяется сервером.

Для RTS это предпочтительнее, чем сразу строить reconciliation/rollback.

---

## 15. GameTransport abstraction

Web UI/presentation не должны знать, работает матч локально или удалённо.

Target boundary:

```ts
interface GameTransport {
  connect(options: ConnectOptions): Promise<void>;
  resumePreviousSession(options?: ResumeSessionOptions): Promise<ResumeSessionResult>;

  sendCommand(command: GameCommand): void;
  subscribeState(listener: StateListener): Unsubscribe;
  subscribeEvent(listener: EventListener): Unsubscribe;
  subscribeConnection(listener: ConnectionListener): Unsubscribe;

  startMatch(): void;
  readonly connectedRoomId: string | null;
  hasResumeToken(): boolean;
  readRoundTripMs(): number | null;

  disconnect(): Promise<void>;
}
```

Session token/SDK internals остаются adapter concern. Local transport естественно не имеет remote resume token; RTT может быть `null`.

```text
RemoteGameTransport → Colyseus SDK
LocalGameTransport  → WebWorker → shared MatchRuntime
```

Lobby/session actions не должны требовать concrete `PageGameTransport` extension поверх GameTransport.

---

## 16. Solo runtime

Solo использует ту же `simulation`, но не требует game server.

Целевая схема:

```text
Browser main thread
  ├─ React
  ├─ Babylon.js
  └─ LocalGameTransport
           │
           ▼
       WebWorker
           │
           ▼
       Simulation
```

Simulation в Worker позволяет не блокировать renderer при AI/pathfinding нагрузке.

В первом network vertical slice Worker может ещё отсутствовать, но `GameTransport` boundary должна существовать до появления полноценного Solo.

---

## 17. Ownership, control и permissions

Для entity различаются понятия:

```text
owner
controller
permissions
```

Минимальная модель:

```ts
OwnerComponent {
  ownerPlayerId: PlayerId | null;
}

ControlComponent {
  controllerPlayerId: PlayerId | null;
}
```

Permissions могут вычисляться системой, а не обязательно храниться на каждом entity.

Это нужно для:

- передачи армии;
- передачи здания;
- восстановления игрока в Coop;
- shared control;
- reconnect;
- AI takeover;
- surrender.

---

## 18. Objectives

Все условия победы/поражения строятся через обобщённую objective model.

Нельзя привязывать engine к конкретному Sacred Site/Tree.

```ts
type Objective = {
  id: ObjectiveId;
  type: "protect" | "destroy" | "capture";
  entityId?: EntityId;
  teamId?: TeamId;
  required: boolean;
};
```

`Sacred Site` — concrete entity/definition identity. `protect` — gameplay objective role, назначенная этой entity.

Первая gameplay реализация использует `protect` для Sacred Site.

---

## 19. Координаты и карта

Simulation — 2D gameplay plane.

Renderer отображает его в 3D.

```text
Simulation: x, y
Babylon:    x, z
```

Юниты имеют continuous coordinates.

Buildings используют grid-aligned footprints.

Карта содержит логический grid для:

- buildability;
- terrain type;
- occupancy;
- pathfinding;
- visibility/fog;
- resource placement.

Renderer terrain mesh не должен быть источником gameplay collision/navigation данных.

---

## 20. Pathfinding

Первая версия:

- grid navigation;
- A* для индивидуальных/групповых запросов;
- ограниченный pathfinding budget на tick;
- cache там, где он очевидно полезен.

Нельзя выполнять сотни дорогих path search синхронно в одном tick без budget.

Для больших PvE волн архитектура должна позволять добавить:

- flow fields;
- shared paths;
- hierarchical pathfinding;
- local steering.

Но эти алгоритмы не реализуются до появления нагрузки, которая оправдывает их.

---

## 21. Fog of war и network visibility

Fog of war — server-owned gameplay information.

Client не должен получать hidden enemy entities только затем, чтобы спрятать их renderer'ом.

Gameplay/simulation layer определяет visibility semantics. Transport-neutral MatchSnapshot содержит только данные, необходимые shared projector'у для authoritative recipient filtering.

`@web-rts/match-adapter` строит recipient-specific `GameStateView` и не придумывает собственные gameplay visibility rules.

Для Coop желательно использовать общую team visibility.

Для PvP — отдельную visibility per player/team.

Поскольку per-recipient filtering может стать дорогим при большом числе entities, его производительность должна измеряться. Boundary `MatchSnapshot → match-adapter → GameStateView` позволяет позже заменить serialization/delta strategy без изменения gameplay model.

---

## 22. Reconnect и disconnect

Первая multiplayer версия должна поддерживать reconnect.

Начальная политика:

- player slot сохраняется **30 секунд** после неожиданного disconnect;
- simulation продолжает работать;
- entity игрока не уничтожаются;
- на время grace Owner и Controller сохраняются;
- reconnect возвращает control;
- явный Disconnect не резервирует slot;
- после timeout поведение определяется game mode policy.

Для network vertical slice после timeout допустимо просто оставить сущности без controller.

Для Coop позже policy может передавать control союзникам или AI.

---

## 23. Room model

Первая версия комнаты:

```text
room id
max players: 4
mode
map id
seed
players
match state
```

Match phases:

```text
LOBBY
STARTING
RUNNING
FINISHED
```

На первом этапе нет публичного matchmaking.

Достаточно:

```text
Create room -> получить code/id -> Join room
```

---

## 24. Client presentation architecture

Renderer не должен читать simulation internals напрямую.

Client получает replicated/view state и преобразует его в presentation entities.

```text
Network/Local state
      ↓
ClientGameState
      ↓
PresentationSync
      ↓
Babylon meshes/instances
```

### Rendering strategy

Для повторяющихся статичных/простых объектов использовать instancing.

Кандидаты:

- деревья;
- ресурсы;
- одинаковые декорации;
- простые hordes;
- одинаковые projectiles/effects.

Thin instances используются там, где нужен максимально дешёвый rendering и не требуется богатое object-level API.

Не оптимизируем всё в thin instances заранее.

---

## 25. React boundary

React используется для web UI:

- main menu;
- room creation/join;
- lobby;
- settings;
- HUD;
- resource counters;
- build menu;
- debug panels.

React **не управляет Babylon scene graph**.

Нельзя хранить тысячи unit transforms в React component state.

Между React и game client используется маленький explicit store/view-model boundary.

Дополнительная state-management library не добавляется до появления необходимости.

---

## 26. Assets

Основной 3D interchange format:

**glTF / GLB**.

В foundation prototype используются primitives и developer art.

Art pipeline не должен блокировать первый playable multiplayer slice.

Рекомендуемая структура позже:

```text
assets/
  models/
  textures/
  audio/
```

Исходники Blender могут храниться отдельно от optimized runtime assets, когда они появятся.

---

## 27. Game data

Balance/config не разбрасывается magic numbers по systems.

Например:

```ts
UNIT_TYPES.soldier = {
  hp: 100,
  speed: 2.5,
  damage: 10,
};
```

`game-data` должен быть:

- typed;
- versioned;
- доступен simulation;
- проверяем тестами.

Для MVP допускаются TypeScript declarative objects.

Не вводим отдельную CMS/data editor.

---

## 28. Persistence

Active match state хранится только в RAM процесса game server.

Нет PostgreSQL.

Нет Redis.

Нет сохранения незавершённого multiplayer match после падения process.

Это осознанное ограничение MVP.

Persistence появляется только вместе с конкретной пользовательской функцией.

---

## 29. Deployment model MVP

### Local development

Основной developer path:

```text
pnpm install
pnpm dev
```

Корневой `pnpm dev` делегирует запуск workspace-задач Turborepo и должен поднять как минимум:

- web client;
- game server.

Остальные стандартные root-level команды (`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`) также должны делегироваться Turborepo, чтобы человек, CI и coding agents использовали один и тот же интерфейс.

### LAN / simple multiplayer

Должен существовать простой путь:

```text
docker compose up
```

После этого другие устройства в LAN могут открыть web client и подключиться к server.

### Remote

Следующий шаг после LAN:

```text
one VPS / one Docker host
```

Никаких orchestrator/cluster до появления реальной нагрузки.

---

## 30. Logging и debug tooling

Server logging — structured logs.

Каждый лог матча должен позволять восстановить контекст:

- roomId;
- matchId;
- playerId при наличии;
- tick;
- event/error type.

Client development build должен иметь debug overlay с минимумом:

```text
FPS
RTT
server tick
entity count
draw calls / renderer stats
```

Babylon Inspector подключается только в development/debug режиме.

---

## 31. Performance philosophy

Оптимизация строится через benchmarks и profiling.

Не вводим сложность только потому, что "RTS когда-нибудь будет большой".

Но архитектура должна позволять измерять:

- simulation tick duration;
- pathfinding duration;
- entity count;
- network bytes/sec;
- replication encode time;
- client FPS;
- draw calls;
- memory.

### Design target, не CI gate

Архитектура должна в перспективе нормально обслуживать матч примерно такого порядка:

```text
4 players
~20-50 controlled combat units per player
hundreds / potentially 1000+ simple PvE enemies
```

Конкретные performance budgets фиксируются после появления baseline benchmark.

---

## 32. Testing strategy

### 32.1 Unit tests

Vitest.

Основной приоритет — `simulation`.

Тестируются:

- command validation;
- movement rules;
- combat;
- ownership/control;
- objectives;
- economy;
- construction;
- pathfinding edge cases.

### 32.2 Scenario tests

Формат:

```text
seed
+ initial world
+ ordered commands
+ N ticks
= expected assertions
```

Scenario runner должен работать без browser и без game server.

### 32.3 Server integration tests

Headless Colyseus clients проверяют:

- create/join room;
- max players;
- command processing;
- state propagation;
- disconnect/reconnect;
- invalid commands.

### 32.4 Browser E2E

Playwright.

Минимальный multiplayer smoke test:

1. открыть два browser context;
2. создать room;
3. подключить второго игрока;
4. отдать MOVE первым игроком;
5. убедиться, что второй клиент видит новое authoritative положение;
6. проверить objective;
7. disconnect/reconnect одного клиента.

Позже добавляются 4-player tests.

### 32.5 Bot client

Headless bot client использует тот же public network protocol, что и browser client.

Он нужен для:

- load tests;
- long-running matches;
- reconnect tests;
- automatic gameplay simulations.

---

## 33. CI

GitHub Actions запускается на каждый PR.

Установка зависимостей выполняется через `pnpm`, а стандартные repository tasks оркестрируются через Turborepo.

Обязательные проверки foundation stage:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
simulation scenario tests
server integration tests
pnpm build
Playwright multiplayer smoke test
```

Root-level `lint/typecheck/test/build` должны использовать Turborepo task graph и local cache там, где задача детерминирована и корректно описаны её inputs/outputs.

Turborepo Remote Cache в foundation не обязателен и подключается только при появлении практической пользы для CI/agent workflow.

`main` должен быть green и запускаться.

Performance benchmark сначала сохраняется как diagnostic output. Hard performance gate добавляется только после появления стабильной baseline.

---

## 34. Coding standards

Основные правила:

- TypeScript `strict`;
- избегать `any` без явной причины;
- domain state не зависит от framework types;
- public package API минимален;
- dependencies направлены внутрь к simulation/contracts;
- composition over inheritance;
- profiling before optimization;
- no speculative abstraction;
- одна фича не должна молча менять архитектурные инварианты.

Не применять механически backend patterns вроде repository/use-case/aggregate к каждому игровому объекту.

---

## 35. Security / trust model

Server authoritative означает:

- клиенту нельзя доверять итоговое состояние;
- trusted PlayerId выводится server/session, а не command payload;
- ownership/control и gameplay semantics проверяются на simulation tick boundary;
- resource costs считаются сервером;
- hidden enemy state не отправляется client;
- remote room input имеет explicit rate limit;
- shared MatchRuntime имеет bounded per-player pending command queues;
- overflow отклоняется machine-readable `queue_full`, без вытеснения уже queued commands;
- deterministic fair scheduling не позволяет одному player неограниченно блокировать command ingress остальных;
- client-controlled strings/arrays/ids/coordinates bounded;
- malformed commands отклоняются runtime validation без падения Room;
- после START новые joins в текущий match блокируются, reserved reconnect остаётся отдельным разрешённым path.

В MVP игроки анонимные. Полноценная account security вне scope.

---

## 36. Agent-driven development rules

Репозиторий должен быть удобен не только человеку, но и coding agents.

### Source of truth

Приоритет контекста:

```text
Game Vision
   ↓
Technical Vision + ADR
   ↓
Feature Spec
   ↓
Issue / implementation task
   ↓
Code + tests
```

Agent не должен менять продуктовые требования из собственного предположения.

Agent не должен вводить новое архитектурное решение, противоречащее Technical Vision, без ADR.

### Единый tooling interface

Coding agents должны по умолчанию пользоваться корневыми командами репозитория:

```text
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Эти команды оркестрируются Turborepo. Агент не должен вручную собирать список команд каждого workspace package, если конкретная задача этого не требует.

### Каждая implementation feature должна иметь

- ссылку на spec;
- acceptance criteria;
- tests;
- описание architectural impact, если оно есть.

### PR philosophy

Предпочтительны небольшие reviewable PR.

Большой запрос должен разбиваться на этапы, если это не разрушает целостность vertical slice.

### Repository instructions

Перед основной кодовой фазой должен появиться корневой `AGENTS.md`, содержащий:

- команды install/dev/test/build;
- архитектурные invariants;
- где лежат specs/ADR;
- требования к tests;
- запрет на самостоятельное расширение scope.

---

## 37. Первый Network Vertical Slice

Первый playable milestone намеренно минимален.

### Пользовательский сценарий

1. Запустить client + server.
2. Игрок A создаёт room.
3. Игрок B подключается по room id/code.
4. Оба видят простую карту.
5. На карте есть Sacred Site.
6. У каждого игрока есть примитивный unit.
7. Игрок A отдаёт MOVE.
8. Server simulation перемещает unit.
9. Оба клиента видят синхронное движение.
10. Игрок A перезагружает страницу и reconnect восстанавливает его slot/control.

### Technical acceptance criteria

- 2-4 clients могут находиться в одной room;
- server authoritative;
- simulation fixed tick 10 Hz;
- client render independent от tick;
- movement идёт через command queue;
- replicated state отделён от simulation state;
- objective существует в simulation;
- ownership/control моделируются отдельно;
- reconnect работает в рамках configured grace period;
- multiplayer E2E test автоматизирован;
- `pnpm dev` запускает dev environment через root-level Turborepo orchestration;
- `docker compose up` способен поднять LAN-compatible build;
- CI проверяет build/typecheck/tests;
- нет database.

### Non-goals vertical slice

- настоящая графика;
- полноценный fog of war;
- экономика;
- строительство;
- combat;
- waves;
- сложный pathfinding;
- Solo gameplay;
- production hosting.

---

## 38. Порядок реализации foundation

Рекомендуемый порядок после утверждения Technical Vision:

```text
F0  Repository/tooling scaffold (pnpm workspaces + Turborepo)
F1  Simulation kernel + fixed tick + scenario tests
F2  Babylon client shell + camera + primitive map
F3  Protocol contracts + GameTransport interface
F4  Colyseus game server + room lifecycle
F5  Replication adapter + primitive movement
F6  Ownership/control + Sacred Site objective
F7  Multiplayer browser E2E
F8  Reconnect
F9  Docker/LAN startup
F10 Debug/performance instrumentation
F11 LocalGameTransport/WebWorker skeleton
```

После F0-F11 можно переходить к первой gameplay spec.

---

## 39. ADR, которые нужно создать перед/во время foundation

Technical Vision фиксирует направление. ADR должны зафиксировать rationale и последствия ключевых решений.

Tooling foundation уже зафиксирован отдельно:

```text
ADR-000 pnpm-workspaces-and-turborepo
```

Минимальный набор игровых/системных ADR:

```text
ADR-001 authoritative-server-and-shared-simulation
ADR-002 babylonjs-renderer
ADR-003 colyseus-multiplayer-layer
ADR-004 fixed-timestep-and-repeatable-simulation
ADR-005 data-oriented-entity-model
ADR-006 local-vs-remote-game-transport
ADR-007 replication-boundary-and-visibility
```

ADR не должны превращаться в огромные документы. Цель — коротко сохранить контекст решения и альтернативы.

---

## 40. Что может изменить этот Technical Vision

Следующие результаты прототипирования являются допустимой причиной пересмотра решений:

- Babylon.js показывает неприемлемую производительность или tooling problem в нашем конкретном rendering profile;
- Colyseus replication становится bottleneck для нужного числа entities;
- 10 Hz simulation даёт неудовлетворительный gameplay feel;
- собственная component model становится bottleneck и требуется специализированный ECS;
- grid A* перестаёт укладываться в performance budget;
- WebWorker boundary даёт слишком высокую serialization overhead для Solo.

Любая такая замена должна начинаться с измерения и ADR, а не с субъективного желания "переписать красивее".

---

## 41. Внешние технические ссылки

- Babylon.js WebGPU support: https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md
- Babylon.js instances: https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/copies/instances.md
- Babylon.js Inspector: https://github.com/BabylonJS/Documentation/blob/master/content/toolsAndResources/inspector.v2.md
- Colyseus documentation: https://docs.colyseus.io/
- Colyseus state synchronization: https://docs.colyseus.io/state
- Colyseus rooms/reconnection: https://docs.colyseus.io/room
- Colyseus State View: https://docs.colyseus.io/state/view
- Playwright: https://playwright.dev/

---

## 42. Итоговый технический контракт v0.1

На текущем этапе проект считается правильно устроенным, если выполняются следующие инварианты:

1. **Simulation не знает о Babylon, React и Colyseus.**
2. **Server является authority в multiplayer.**
3. **Solo и multiplayer используют одни игровые правила.**
4. **Client отправляет commands, а не authoritative state.**
5. **Rendering state отделён от simulation state.**
6. **Network replication отделён от simulation state.**
7. **Игровое время основано на fixed tick.**
8. **Randomness проходит через seeded RNG.**
9. **Ownership и control не считаются одним понятием.**
10. **Objectives обобщены и не зашиты под один Sacred Tree.**
11. **Database не появляется без persistent use case.**
12. **Architecture change требует ADR.**
13. **Feature implementation начинается со spec и acceptance criteria.**
14. **Основной gameplay код должен быть тестируем без browser.**
15. **Сложность добавляется после измерения, а не заранее.**
16. **pnpm управляет workspace/dependencies, Turborepo — repository task orchestration/cache; runtime от Turbo не зависит.**
