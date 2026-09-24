# ADR-002: Babylon.js renderer

Статус: **Accepted**  
Дата: **2026-09-24**

## Контекст

Выбран визуальный стиль stylized low-poly 3D с изометрической камерой. Клиент должен отображать много повторяющихся объектов, поддерживать developer tooling и не требовать большого собственного rendering glue.

## Решение

Использовать **Babylon.js** как основной 3D renderer/client engine.

React используется только для web UI/HUD и не управляет Babylon scene graph.

Предпочтительная стратегия backend:

```text
WebGPU, если окружение поддерживает его стабильно
          ↓ fallback
WebGL
```

Для повторяющихся объектов допускаются hardware instances и thin instances по результатам profiling.

Runtime assets — преимущественно glTF/GLB.

## Почему

Babylon.js предоставляет game-oriented abstraction, scene/camera tooling, Inspector, asset pipeline и встроенные механизмы instancing. Это уменьшает количество инфраструктурного кода, который придётся писать и сопровождать вручную или агентами.

## Последствия

Плюсы:

- меньше собственного engine glue;
- удобный runtime debugging;
- подходящая модель для low-poly 3D;
- путь к WebGPU без отдельного renderer rewrite;
- встроенные оптимизации для повторяющихся meshes.

Минусы:

- более крупный и opinionated framework, чем Three.js;
- необходимо не допустить проникновения Babylon types в simulation/domain packages;
- performance всё равно должен проверяться на нашем конкретном RTS workload.

## Альтернативы

### Three.js

Рассматривался как сильная альтернатива. Отклонён для foundation в пользу более game-oriented tooling Babylon.js.

### Phaser

Не подходит как основной renderer после выбора полноценного 3D-направления.

## Инварианты

- Babylon.js существует только в presentation/client layer;
- simulation не импортирует Babylon.js;
- React не хранит тысячи entity transforms;
- выбор Babylon.js может быть пересмотрен только по результатам измеримого прототипа и нового ADR.
