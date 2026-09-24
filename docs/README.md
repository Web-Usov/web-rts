# Документация Web RTS

Этот каталог — источник продуктовых и технических решений проекта.

## Документы

- [`game-vision.md`](./game-vision.md) — Game Vision v0.1: направление игры, режимы, core loop, цели матча и границы MVP.
- [`technical-vision.md`](./technical-vision.md) — Technical Vision v0.1: зафиксированный стек, simulation architecture, networking, rendering, testing, CI и agent-driven development rules.
- [`technical-direction.md`](./technical-direction.md) — Technical Direction v0.1: предварительный документ, на основе которого сформирован Technical Vision. При расхождениях приоритет имеет `technical-vision.md`.

## Как развиваем документацию

- Продуктовые решения фиксируются в `game-vision.md` или отдельных спецификациях в `docs/specs/`.
- Значимые технические решения оформляются как ADR в `docs/adr/`.
- Реализация конкретной фичи должна начинаться со spec и acceptance criteria.
- GitHub Issues используются для задач реализации, а не как единственное место хранения продуктовой документации.
- Архитектурное решение, противоречащее Technical Vision, требует отдельного ADR.
- `main` должен оставаться в запускаемом и проверяемом состоянии.
