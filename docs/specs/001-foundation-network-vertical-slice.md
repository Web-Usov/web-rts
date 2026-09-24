# Foundation Spec #001 — Network Vertical Slice

Статус: **Proposed**  
Дата: **2026-09-24**  
Проект: **Web RTS**

## 1. Цель

Создать первый технически целостный playable foundation для Web RTS, который доказывает выбранную архитектуру до начала полноценного gameplay.

Результат этапа: 2–4 браузерных клиента могут подключиться к одной комнате, видеть одну примитивную карту, Sacred Site и свои юниты, отправлять MOVE-команды, а authoritative server выполняет simulation и реплицирует состояние всем клиентам. Disconnect/reconnect восстанавливает player slot/control.

Foundation должен быть достаточно простым, чтобы быстро получить работающий vertical slice, но уже соблюдать архитектурные инварианты Technical Vision и ADR.

## 2. Source of truth

Реализация обязана соответствовать:

- `docs/game-vision.md`;
- `docs/technical-vision.md`;
- `docs/adr/000-pnpm-turborepo-monorepo.md`;
- `docs/adr/001-authoritative-server-and-shared-simulation.md`;
- `docs/adr/002-babylonjs-renderer.md`;
- `docs/adr/003-colyseus-multiplayer-layer.md`;
- `docs/adr/004-fixed-timestep-and-repeatable-simulation.md`;
- `docs/adr/005-data-oriented-entity-model.md`;
- `docs/adr/006-local-vs-remote-game-transport.md`;
- `docs/adr/007-replication-boundary-and-visibility.md`.

Если implementation task требует изменить один из этих принципов, работа останавливается на уровне архитектуры и сначала создаётся/обновляется ADR.

## 3. Scope

В Foundation #001 входят:

- pnpm workspaces + Turborepo monorepo;
- `apps/web`;
- `apps/game-server`;
- `packages/simulation`;
- `packages/protocol`;
- `packages/game-data`;
- `packages/testkit`;
- `tools/bot-client` и/или минимальный headless network client;
- TypeScript strict;
- Vite + React shell;
- Babylon.js primitive 3D scene;
- Colyseus room/server;
- authoritative simulation;
- fixed tick 10 Hz;
- repeatable seeded simulation foundation;
- protocol versioning;
- `GameTransport` boundary;
- primitive numeric entities;
- primitive map;
- Sacred Site objective;
- ownership/control distinction;
- MOVE command;
- replicated state boundary;
- interpolation на клиенте;
- create/join room flow;
- 2–4 clients;
- reconnect grace period;
- automated unit/scenario/server/browser tests;
- GitHub Actions CI;
- Docker Compose LAN startup;
- debug/performance counters foundation.

## 4. Non-goals

Не входят:

- production graphics;
- gameplay economy;
- buildings/construction;
- combat;
- enemy waves;
- fog of war gameplay;
- complex pathfinding;
- Solo gameplay;
- LocalGameTransport production implementation;
- matchmaking;
- accounts;
- database;
- Redis;
- persistence match state;
- public production hosting;
- mobile support;
- audio;
- art pipeline;
- procedural map generation.

## 5. Repository structure

Целевая начальная структура:

```text
apps/
  web/
  game-server/

packages/
  simulation/
  protocol/
  game-data/
  testkit/

tools/
  bot-client/
  scenario-runner/

docs/
  specs/
  adr/
```

Package boundaries должны оставаться небольшими. Новые packages не создаются без конкретной причины.

## 6. Tooling contract

Корневые команды должны быть единым интерфейсом для человека, CI и coding agents:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Корневые scripts используют Turborepo для orchestration.

`pnpm dev` должен одновременно запускать web и game server.

## 7. Simulation contract

`packages/simulation`:

- не импортирует React;
- не импортирует Babylon.js;
- не импортирует Colyseus;
- не импортирует DOM/browser API;
- не зависит от Node-specific API;
- не читает wall-clock time;
- не использует `Math.random()` для gameplay;
- работает через fixed tick;
- поддерживает seeded RNG abstraction;
- тестируется без browser/server.

Начальная simulation frequency: **10 Hz / 100 ms per tick**.

Минимальный world:

```text
World
 ├─ tick
 ├─ entities
 ├─ components
 ├─ command queue
 ├─ event queue
 └─ rng
```

Минимальные component concepts:

- Position;
- Movement;
- Owner;
- Controller;
- Objective.

Entity IDs — компактные numeric IDs.

## 8. Protocol contract

Protocol package содержит типы и runtime schemas.

Минимальные protocol concepts:

```text
protocolVersion
gameDataVersion
player/session identity
room options
GameCommand
GameEvent
state/view DTO
```

Минимальная команда vertical slice:

```text
MOVE
```

MOVE содержит intent, например:

```ts
{
  type: "MOVE";
  commandId: string;
  clientSequence: number;
  entityIds: number[];
  target: { x: number; y: number };
}
```

`playerId` не должен приниматься как доверенный authority из payload клиента, если сервер может вывести identity из session/connection.

Server валидирует schema и permissions до постановки команды в simulation queue.

## 9. Multiplayer room

Минимальная Room model:

```text
roomId
maxPlayers = 4
mode = foundation
mapId
seed
players
phase
```

Phases:

```text
LOBBY
STARTING
RUNNING
FINISHED
```

Foundation UI может быть техническим:

- Create room;
- показать room code/id;
- Join room;
- список подключённых игроков;
- Start match автоматически или минимальной кнопкой.

Публичный matchmaking не нужен.

## 10. Match initialization

При старте матча:

- создаётся один Sacred Site objective;
- каждому подключённому игроку создаётся один primitive controllable unit;
- у каждого unit есть owner и controller;
- стартовые позиции различаются;
- карта одинакова для всех клиентов;
- server является единственным authority.

## 11. Movement

Foundation movement может быть максимально простым.

Требования:

- игрок может выбрать только контролируемый им unit;
- client отправляет target point;
- server проверяет control;
- command применяется на tick boundary;
- simulation изменяет позицию со временем, а не teleport, если это не усложняет foundation чрезмерно;
- клиенты получают authoritative transforms;
- presentation интерполирует движение между server states.

Сложный collision avoidance/pathfinding не нужен. Допустимо прямолинейное движение в пределах карты.

## 12. Sacred Site

Sacred Site существует как generalized objective/entity, а не hardcoded renderer object.

В vertical slice достаточно:

- objective существует в simulation;
- имеет entity id/position/state;
- реплицируется клиентам;
- отображается отдельным primitive mesh;
- тест подтверждает наличие objective после match start.

Поражение/разрушение objective пока не требуется.

## 13. Ownership и control

Минимально различаются:

```text
ownerPlayerId
controllerPlayerId
```

MOVE разрешён только текущему controller.

Foundation должен иметь unit test, показывающий, что изменение controller меняет право отдавать команду без изменения owner.

## 14. Replication boundary

Simulation state не является Colyseus Schema напрямую.

Должен существовать явный adapter/projection:

```text
Simulation World
      ↓
Replication Adapter
      ↓
Network State
```

Foundation пока может реплицировать одинаковое состояние всем игрокам; полноценный fog filtering не входит в scope.

Но структура не должна мешать будущей per-player/team visibility.

## 15. Client architecture

Client path:

```text
RemoteGameTransport
        ↓
ClientGameState
        ↓
PresentationSync
        ↓
Babylon scene
```

React используется для menu/lobby/HUD/debug UI.

React не хранит per-frame transforms всех entities.

Babylon scene не является gameplay state.

## 16. GameTransport

Минимальный interface должен отделять client от Colyseus API.

Пример направления:

```ts
interface GameTransport {
  connect(options: ConnectOptions): Promise<void>;
  sendCommand(command: GameCommand): void;
  subscribeState(listener: StateListener): Unsubscribe;
  subscribeEvent(listener: EventListener): Unsubscribe;
  disconnect(): Promise<void>;
}
```

В Foundation реализуется `RemoteGameTransport`.

Для будущего Solo должна быть возможность реализовать `LocalGameTransport` без изменения presentation/HUD path.

## 17. Reconnect

Начальная reconnect policy:

- grace period: **30 seconds**;
- player slot сохраняется;
- simulation продолжает работать;
- unit не удаляется;
- reconnect восстанавливает controller/session;
- после timeout entity остаётся существовать, но может потерять controller.

Политика AI takeover не входит в Foundation.

## 18. Primitive presentation

Разрешён только developer art.

Минимально:

- plane/grid terrain;
- Sacred Site — отдельный primitive;
- player unit — простой mesh;
- визуальное различие игроков;
- isometric/RTS-like camera;
- pan/zoom;
- click selection;
- destination marker.

Art quality не является acceptance criterion.

## 19. Debug instrumentation

Development UI/server logs должны показывать/содержать минимум:

Client:

- FPS;
- RTT/ping, если доступен;
- server tick;
- entity count.

Server:

- room id;
- tick;
- player/session context для network events;
- simulation tick duration basic metric/logging.

## 20. Automated testing

### Unit/scenario

Обязательны tests для:

- fixed tick progression;
- repeatable seeded result;
- command queue on tick boundary;
- movement;
- ownership/control permissions;
- objective initialization.

### Server integration

Headless clients проверяют:

- create/join room;
- max 4 players;
- invalid command rejection;
- MOVE propagation;
- disconnect/reconnect.

### Browser E2E

Playwright smoke:

1. browser A создаёт room;
2. browser B подключается;
3. оба входят в RUNNING match;
4. A двигает свой unit;
5. B видит authoritative movement;
6. A reload/disconnect;
7. A reconnect;
8. control восстанавливается.

## 21. CI

На каждый PR:

```text
pnpm install --frozen-lockfile
lint
TypeScript typecheck
unit tests
scenario tests
server integration tests
build web
build server
Playwright multiplayer smoke
```

CI запускается через root-level scripts/Turborepo там, где применимо.

`main` должен оставаться green.

## 22. Docker / LAN

Должен существовать простой путь запуска:

```bash
docker compose up
```

После запуска другое устройство в одной LAN должно иметь возможность открыть web URL и подключиться к game server без изменения исходников.

Environment/config допускается через `.env`/documented variables.

## 23. Security/trust minimum

Даже foundation обязан:

- не доверять client state;
- валидировать incoming commands runtime schema;
- проверять controller permissions;
- ограничивать неприемлемый payload size/rate простым разумным механизмом, если Colyseus/server layer предоставляет подходящую точку;
- не падать от malformed message.

Полный anti-cheat не нужен.

## 24. Definition of Done

Foundation Spec #001 завершён, когда одновременно выполняется следующее:

- свежий clone запускается документированными командами;
- `pnpm dev` поднимает web + server;
- два браузера создают/подключаются к одной комнате;
- оба видят один Sacred Site и player units;
- MOVE проходит client → transport → server → simulation → replication → presentation;
- сервер authoritative;
- simulation работает fixed 10 Hz;
- renderer работает независимо;
- ownership/control разделены;
- reconnect работает;
- automated browser multiplayer smoke test green;
- simulation tests green;
- Docker Compose LAN path работает;
- CI green;
- нет database;
- код соответствует `AGENTS.md` и ADR.

## 25. Implementation breakdown

Foundation реализуется последовательностью задач:

```text
F0  Repository/tooling scaffold
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

F11 реализует только архитектурный skeleton/contract proof; полноценный Solo gameplay остаётся за пределами Foundation #001.
