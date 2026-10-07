# G4a — повторная браузерная проверка после smoothing

Инструмент: внутренний Codex browser / `mcp__cua_repl`, локальный Vite из task worktree, `http://127.0.0.1:5179/?transport=local`.

Проверено через реальные left/right clicks по canvas:

1. Create room → Start → выбрать стартовый unit слева от Sacred Site.
2. На свободной местности выполнить диагональный MOVE вправо и вверх. Кадры 07–10: старт, две промежуточные позиции на прямом отрезке и остановка на маркере. Grid-shaped `Г` не наблюдается.
3. Переместить unit вниз-вправо для обходного сценария. Отдать MOVE на противоположную сторону Sacred Site. Кадры 11–14: исходная позиция, поворот у footprint, выход из обхода, остановка в исходной точке назначения.
4. HUD: Selected `1`, Destination `marked`, Last event `—`; предупреждений и console/runtime errors в проверенном flow нет (browser dev logs для `error`/`warn` пусты).

Маркер — только UX. Exact simulation destination после обхода дополнительно проверена unit-тестами; browser evidence показывает визуальное совпадение остановки с маркером.

Кадры 01–06 сохранены как evidence исходного G4a до smoothing. Для актуального execution behavior используются 07–14.

Automated regression `G4a open-terrain diagonal MOVE stays on a straight rendered line` в `tests/e2e/foundation-local.spec.ts` проверяет промежуточные положения по пикселям Babylon canvas и отклонение от прямой, без чтения simulation/transport state.
