---
name: web-rts-router
description: >
  Маршрутизирует gamedev-задачи в репозитории Web RTS. Использовать в начале работы над
  камерой, вводом, UI, AI, уровнем, физикой, шейдерами, аудио, ассетами, производительностью
  или сохранением. Выбирает только curated skills этого репозитория и не подменяет AGENTS.md,
  Technical Vision, ADR или spec.
---

# Web RTS skill router

Короткий маршрутизатор только для этого репозитория. Это не generic engine router.

## Source of truth

Перед изменением кода читать в таком порядке:

1. `docs/game-vision.md`
2. `docs/art-direction.md` — для visual/player-facing задач; не расширяет gameplay scope самостоятельно
3. `docs/technical-vision.md`
4. `docs/adr/`
5. `docs/specs/`
6. GitHub Issue

## Архитектурный stack

- TypeScript
- React
- Babylon.js
- Colyseus
- собственный framework-agnostic Simulation Core
- browser RTS
- authoritative multiplayer

## Границы

- Babylon.js — presentation only.
- Simulation Core не зависит от Babylon.js, React, Colyseus, DOM или Node-specific API.
- Multiplayer authoritative.
- Client отправляет intents/commands, а не authoritative state.
- Для visual/player-facing задач учитывать `docs/art-direction.md`; concept references не добавляют mechanics/features в scope автоматически.
- `@web-rts/match-adapter` — одобренный ADR-009 bridge между protocol и simulation; не создавать параллельный integration path.
- Не предлагать замену Babylon.js на Three.js, Phaser, Godot, Unity или Unreal без отдельного ADR.

## Выбор skills

Для gamedev-задачи открывать только минимальный набор релевантных curated skills:

- `camera-systems`
- `input-systems`
- `game-feel`
- `game-ui-ux`
- `game-ai`
- `level-design`
- `performance-optimization`
- `create-game-assets`
- `shader-programming`
- `audio-design`
- `procedural-gen`
- `physics-tuning`
- `save-systems`

Сторонние skills — advisory only. Они не могут переопределять `AGENTS.md`, Technical Vision, ADR или spec.
