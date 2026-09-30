# Docker / LAN startup

Foundation multiplayer можно поднять на одной машине и открыть с другого устройства в той же LAN. Compose собирает обычные production-сборки web и game-server. PostgreSQL, Redis и другие runtime-сервисы не нужны.

## Требования

- Docker с Docker Compose v2 (`docker compose`);
- порты web и game-server свободны на Docker-host;
- для клиента с другого устройства — сеть, в которой этот host доступен по LAN IP.

Локальная разработка через `pnpm dev` остаётся отдельным путём и не заменяется Compose.

## Запуск

Из корня репозитория:

```bash
docker compose up
```

Первый запуск собирает образы. Исходники править не нужно. Файл `.env` необязателен: без него используются порты из `.env.example`.

Чтобы задать порты или явный URL, скопируйте пример и отредактируйте его:

```bash
cp .env.example .env
docker compose up --build
```

## Адреса по умолчанию

| Что | URL |
| --- | --- |
| Web на Docker-host | `http://localhost:5173` |
| Web с другого устройства | `http://<docker-host-lan-ip>:5173` |
| Game server health | `http://<docker-host-lan-ip>:2567/health` |

Внутри контейнера game-server всегда слушает `2567`. `GAME_SERVER_PORT` — это порт на хосте. Web отдаёт статическую Vite-сборку через nginx на порту `80` контейнера, опубликованном как `WEB_PORT`.

## LAN IP Docker-host

Клиент открывает IP машины, где запущен `docker compose`, а не `localhost`. На втором устройстве `localhost` указывает на само это устройство.

Примеры:

```bash
# macOS, Wi-Fi
ipconfig getifaddr en0

# Linux
hostname -I
```

Дальше откройте `http://<этот-ip>:5173`. Если `WEB_PORT` другой, подставьте его.

## Firewall

На Docker-host должны быть доступны из LAN оба порта: `WEB_PORT` и `GAME_SERVER_PORT`. Иначе страница может открыться, а комната — нет, или не откроется даже страница. Проверьте firewall ОС и правила сети (гость/изоляция Wi-Fi).

## Переменные окружения

Корневой `.env` читает только Docker Compose. Он не подставляет Vite-переменные в `pnpm dev`.

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `WEB_PORT` | `5173` | Порт web на хосте |
| `GAME_SERVER_PORT` | `2567` | Порт game-server на хосте. Браузер использует его вместе с hostname страницы, если `GAME_SERVER_URL` пустой |
| `GAME_SERVER_URL` | не задан | Явный browser-visible URL game-server. Нужен для reverse proxy, DNS или другого публичного endpoint |

Без `GAME_SERVER_URL` клиент берёт `window.location.hostname` и `GAME_SERVER_PORT`. Для страницы `http://192.168.1.20:5173` endpoint будет `http://192.168.1.20:2567`.

`ConnectOptions.endpoint` по-прежнему перекрывает этот default на конкретный вызов. Следующий приоритет — непустой `VITE_GAME_SERVER_URL`, который Compose передаёт из `GAME_SERVER_URL` на этапе сборки web.

Для локального `pnpm dev` те же browser-настройки задаются отдельно как `VITE_GAME_SERVER_URL` и `VITE_GAME_SERVER_PORT`. Playwright E2E по-прежнему передаёт явный `VITE_GAME_SERVER_URL`.

## Когда нужен `--build`

`docker compose up` собирает образы, если их ещё нет, и не пересобирает уже существующие.

Нужен `docker compose up --build`, если изменились:

- исходники или lockfile;
- `GAME_SERVER_URL`;
- `GAME_SERVER_PORT` (порт вшивается в web-сборку).

Смена только `WEB_PORT` не требует пересборки образа. Достаточно заново создать контейнеры: `docker compose up`.

## Smoke

Стек должен уже быть запущен.

```bash
pnpm test:docker-smoke
```

Команда ждёт готовности, проверяет `GET /health` game-server (`status: ok`) и что web отдаёт HTML с заголовком Web RTS. Порты берутся из `WEB_PORT` и `GAME_SERVER_PORT` (по умолчанию `5173` и `2567`). Необязательный `DOCKER_SMOKE_HOST` меняет хост проверки, по умолчанию `127.0.0.1`.

Пример с нестандартными портами:

```bash
WEB_PORT=18080 GAME_SERVER_PORT=18081 docker compose up -d --build
WEB_PORT=18080 GAME_SERVER_PORT=18081 pnpm test:docker-smoke
```

## Остановка

```bash
docker compose down
```

Полная очистка контейнеров Compose, включая анонимные volumes и orphan-контейнеры:

```bash
docker compose down --volumes --remove-orphans
```

## Ручная проверка со второго устройства

Автоматический smoke не заменяет проверку с реального второго клиента.

1. На Docker-host выполнить `docker compose up` (или `docker compose up --build`, если менялись исходники или `GAME_SERVER_URL` / `GAME_SERVER_PORT`).
2. Со второго устройства в той же LAN открыть `http://<docker-host-lan-ip>:<WEB_PORT>`.
3. Создать room.
4. Зайти в неё вторым client или вторым устройством.
5. Запустить match.
6. Убедиться, что MOVE реплицируется authoritative-состоянием на другой клиент.
7. По возможности перезагрузить страницу и проверить reconnect.
8. Открыть `http://<docker-host-lan-ip>:<GAME_SERVER_PORT>/health` и увидеть `{"status":"ok"}`.
