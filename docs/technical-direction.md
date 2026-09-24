# Technical Direction v0.1

Статус: **Draft / предварительно согласованное техническое направление**  
Проект: **Web RTS**

Этот документ фиксирует технические решения, уже принятые на уровне направления. Он **не заменяет** будущий Technical Vision и ADR. Неопределённые решения явно помечены как TBD.

## 1. Главный архитектурный принцип

Web RTS проектируется как **client-server игра с authoritative game server**.

Даже если первый multiplayer запускается локально или внутри LAN, архитектура не должна зависеть от peer-to-peer модели.

Базовая схема:

```text
Browser Client
      │
      │ commands / state updates
      ▼
Authoritative Game Server
      │
      ▼
Simulation Core
```

Game server принимает намерения игроков, валидирует их и является источником истины для multiplayer-состояния.

## 2. Сервер в MVP

Для первого MVP не требуется отдельная production-инфраструктура.

Предпочтительный путь:

```text
MVP #1: localhost / LAN
        ↓
MVP #2: один Docker-host / VPS
        ↓
позже: lobby / matchmaking / несколько game-server instances
```

Первый multiplayer должен иметь возможность запускаться локально, например через Docker Compose, и использовать ту же серверную архитектуру, которая позднее переносится на удалённый сервер.

## 3. Почему не P2P как основа

P2P/WebRTC не выбирается основной архитектурой для первой версии из-за дополнительной сложности:

- NAT traversal;
- STUN/TURN;
- host migration;
- потеря host;
- cheating;
- reconnect;
- различия браузерных окружений;
- более сложная модель синхронизации состояния.

P2P может быть исследован позже, если появится конкретная причина.

## 4. Simulation Core

Игровая симуляция должна быть отдельным пакетом и не зависеть от:

- renderer;
- DOM;
- WebSocket;
- HTTP;
- базы данных;
- конкретного browser API;
- конкретного server framework.

Желаемая модель:

```ts
const world = createWorld(config);

world.applyCommand({
  playerId: "p1",
  type: "MOVE",
  unitIds: ["u1", "u2"],
  target: { x: 20, y: 10 },
});

world.tick(dt);
const snapshot = world.getSnapshot();
```

Одна и та же simulation должна использоваться в:

- game server;
- автоматических тестах;
- bot/load tests;
- replay tooling;
- потенциально WebWorker для локального режима.

## 5. Solo и multiplayer

Игровые правила не должны иметь отдельную реализацию для Solo и multiplayer.

Цель:

```text
Solo:
Browser → Simulation (например WebWorker)

Multiplayer:
Browser → WebSocket → Game Server → Simulation
```

Конкретный способ запуска Solo ещё не зафиксирован окончательно, но simulation rules должны оставаться общими.

## 6. Сетевая модель

Базовый подход — **server authoritative**.

Клиент отправляет команды/намерения:

- move;
- build;
- train;
- attack;
- transfer;
- другие игровые действия.

Сервер определяет фактический результат:

- допустима ли команда;
- реальные координаты;
- HP;
- ресурсы;
- создание/уничтожение объектов;
- победа/поражение.

Предварительный runtime-подход:

```text
Client render: ~60 FPS
Game simulation: fixed tick, ориентир 10–20 ticks/sec
Client: interpolation / presentation
```

Точное значение tick rate определяется после прототипа и профилирования.

## 7. Protocol

Первая версия протокола должна быть простой и наблюдаемой.

Предпочтительно начать с JSON-сообщений и WebSocket.

Пример command:

```json
{
  "type": "MOVE",
  "unitIds": ["u12", "u13"],
  "target": { "x": 43, "y": 22 }
}
```

Оптимизации вроде:

- MessagePack;
- Protobuf;
- custom binary protocol;
- delta snapshots;
- client prediction;
- interest management

добавляются только после измерений и появления реальной необходимости.

## 8. Entity ownership и control

Simulation не должна предполагать, что `owner === controller` всегда и навсегда.

Минимально концептуально нужно различать:

- `owner` — кому принадлежит объект;
- `controller` — кто сейчас может им управлять;
- `permissions` — какие действия разрешены.

Это необходимо для:

- передачи юнитов;
- передачи зданий;
- coop recovery;
- reconnect;
- выхода игрока;
- surrender;
- AI takeover;
- потенциального shared control.

## 9. Objectives

Игровые цели должны моделироваться обобщённо.

Нельзя зашивать единственный объект вроде:

```ts
world.sacredTree
```

Предпочтительное направление:

```ts
world.objectives: GameObjective[]
```

Это позволит поддерживать:

- один Sacred Site;
- несколько Sacred Sites;
- уничтожение цели;
- удержание области;
- будущие сценарные objectives.

## 10. Карта и pathfinding

Карта должна иметь дискретную/grid-основу или эквивалентную структуру, пригодную для:

- строительства;
- проходимости;
- pathfinding;
- fog of war;
- определения территории;
- масштабного PvE.

Для ранней версии допустим простой A* и небольшие армии.

При росте числа PvE-юнитов архитектура должна позволять перейти к более подходящим алгоритмам, например flow fields или групповому pathfinding.

Оптимизация pathfinding заранее не является целью MVP.

## 11. Renderer / client engine

Первоначальная идея Phaser больше не считается подходящим основным renderer, поскольку выбранное визуальное направление — stylized low-poly 3D с изометрической камерой.

### TBD

Нужно отдельно сравнить как минимум:

- Babylon.js;
- Three.js.

Критерии выбора:

- производительность в браузере;
- работа с большим числом простых объектов;
- instancing;
- camera/input;
- asset pipeline;
- animation;
- tooling/debugging;
- удобство agent-generated code;
- размер и сложность abstraction layer;
- testability.

До отдельного решения engine не фиксируется.

## 12. UI

Игровой renderer и обычный web UI должны быть разделены.

Web UI может отвечать за:

- главное меню;
- lobby;
- room setup;
- настройки;
- часть HUD;
- debug tooling.

Конкретный UI framework будет определён в Technical Vision. React допустим, но пока не является обязательным решением.

## 13. Monorepo

Предварительное направление — TypeScript monorepo, вероятно pnpm workspace.

Рабочая структура:

```text
/apps
  web-client
  game-server

/packages
  simulation
  protocol
  game-config
  map
  ai
  test-utils

/tools
  bots
  map-generator

/docs
  specs
  adr
```

Финальная структура уточняется до начала основной реализации.

## 14. Хранение состояния

На раннем этапе состояние активного матча хранится в памяти game server.

PostgreSQL, Redis и другие внешние хранилища **не добавляются автоматически**.

База данных появится только для конкретных persistent use cases, например:

- аккаунты;
- статистика;
- matchmaking;
- meta progression;
- история матчей.

Эти функции не входят в первоначальный MVP.

## 15. Архитектурные границы

Чистота архитектуры должна обеспечиваться на границах системы, но проект не должен превращаться в enterprise-backend внутри каждого юнита.

Не требуется автоматически применять к simulation:

- DDD aggregates на каждую сущность;
- CQRS на каждое действие;
- repositories для каждого типа объекта;
- event bus без реальной необходимости;
- сложные abstraction layers заранее.

Приоритеты simulation:

- предсказуемые правила;
- простые структуры данных;
- производительность;
- тестируемость;
- понятные системные границы.

Высокоуровневые слои:

```text
GAME RULES
simulation / entities / systems / AI / pathfinding

APPLICATION
game session / player connection / lobby / commands

TRANSPORT
WebSocket / HTTP

PRESENTATION
3D renderer / UI / audio / animation
```

`simulation` не должна зависеть от транспортного и presentation-слоя.

## 16. Первый vertical slice

Первый playable prototype намеренно должен быть визуально примитивным.

Цель:

> Два или больше браузеров подключаются к одному game server, видят одну карту и синхронно управляют примитивными юнитами вокруг игрового objective.

Vertical slice должен доказать:

- simulation lifecycle;
- fixed tick;
- protocol;
- room/session lifecycle;
- подключение 2–4 клиентов;
- primitive movement;
- ownership/control;
- Sacred Site / objective;
- state synchronization;
- disconnect/reconnect model;
- автоматические тесты;
- CI.

Красивые модели, сложная экономика и полноценный AI в этот этап не входят.

## 17. Порядок крупных этапов

Предварительно:

```text
P0 — Foundation / simulation / renderer skeleton
P1 — Network vertical slice
P2 — Solo gameplay
P3 — Coop
P4 — PvP / PvPvE
```

Важно технически доказать multiplayer рано, чтобы game state не оказался случайно привязан к client-owned архитектуре.

## 18. Автоматизированное тестирование

### Simulation tests

Игровые правила должны тестироваться без браузера.

Примеры:

- башня наносит ожидаемый урон;
- wave spawner создаёт ожидаемую волну;
- уничтожение objective завершает матч;
- передача unit control корректно меняет permissions;
- экономика детерминированно обновляется по tick.

### Deterministic scenarios

Желательно поддержать сценарии вида:

```text
seed + initial state + command sequence → expected state at tick N
```

Это позволит выполнять regression tests simulation.

### Multiplayer E2E

Через Playwright или эквивалентный инструмент:

- поднять server;
- открыть 2–4 browser contexts;
- подключить их в одну room;
- выполнить действие одним клиентом;
- проверить, что остальные получили корректное состояние.

### Bot clients

Нужен headless/fake client, способный:

- join room;
- move;
- build;
- train;
- attack;
- transfer.

Он будет использоваться для:

- integration tests;
- simulation stress tests;
- сетевых тестов;
- массового прогона матчей.

## 19. Agent-driven development

Цель проекта — максимально автоматизированная разработка через агентов.

Предпочтительный pipeline:

```text
Idea / change
    ↓
Product / Spec Agent
    ↓
SPEC + acceptance criteria
    ↓
Architecture decision (если нужно)
    ↓
Coding Agent
    ↓
PR
   ↙ ↘
Tests  Review
   ↘ ↙
CI
    ↓
Playable build / preview
```

Coding agent не должен самостоятельно придумывать продуктовые требования, если они не определены в spec.

## 20. Документационная модель

Планируемая структура:

```text
docs/
  game-vision.md
  technical-direction.md
  specs/
  adr/
```

### Specs

Каждая существенная фича должна описывать:

- цель;
- scope;
- non-goals;
- пользовательское поведение;
- acceptance criteria;
- ограничения;
- edge cases.

### ADR

Значимые архитектурные решения фиксируются отдельно, например:

- authoritative server;
- renderer choice;
- fixed timestep;
- protocol;
- grid/map model;
- room/session model.

## 21. Принципы проекта

1. Gameplay прежде визуального polish.
2. Одна simulation для всех режимов.
3. Multiplayer строится вокруг authoritative server.
4. Game server может запускаться локально; VPS не обязателен для первого prototype.
5. Simulation не зависит от renderer и transport.
6. Простое решение используется до появления измеренной причины для усложнения.
7. Каждая значимая фича начинается со spec и acceptance criteria.
8. Coding agent не определяет продуктовую логику вместо spec.
9. PR должен проходить автоматические тесты и review.
10. `main` должен оставаться запускаемым.
11. Оптимизации вводятся после профилирования.
12. Архитектура должна позволять масштабирование, но не симулировать проблемы масштаба заранее.

## 22. Что нужно решить следующим

В следующем Technical Vision необходимо зафиксировать:

- Babylon.js vs Three.js;
- конкретный client stack;
- конкретный server runtime/framework;
- monorepo tooling;
- fixed timestep и target tick rate;
- snapshot/event synchronization model;
- room/session/reconnect lifecycle;
- entity/system representation;
- map representation;
- testing stack;
- CI/CD и preview deployment;
- agent roles и правила workflow;
- первые implementation specs и ADR.
