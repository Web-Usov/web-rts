# Art Direction concept references

Статус: **Concept / reference only — not production assets**  
Дата: **2026-10-05**

Эти изображения сохранены как visual targets для [docs/art-direction.md](../../art-direction.md).

Они используются для обсуждения:

- композиции;
- плотности объектов;
- shape language;
- palette direction;
- relative scale;
- close / normal / strategic zoom readability.

Они **не** являются runtime assets, финальными моделями, финальным дизайном карты или утверждённым дизайном PvE.

Наличие конкретного объекта на reference-кадре (например, ворот, поля, дороги, quarry, моста, большого siege mechanism или большого числа юнитов) **не расширяет scope gameplay spec**. References фиксируют визуальные принципы — композицию, shape language, density и readability.

## Approved hybrid target

Основной production-style reference после #75 — **Stylized Low-Poly / Soft Hand-Painted**.

Четыре `hybrid-*.jpg` файла ниже — лёгкие repository preview derivatives утверждённых source renders. Они нужны для долговременной визуальной привязки в GitHub и документации; это **не production textures/assets** и не исходники полного разрешения.

- painterly exploration остаётся mood/material reference;
- explicit low-poly exploration остаётся geometry/readability reference;
- hybrid set является primary visual acceptance input для G13 (#66).

## Files and provenance

| File | Purpose | Generation source | Original generation id | Repository derivative |
|---|---|---|---|---|
| hybrid-overview.jpg | approved hybrid strategic overview | OpenAI image generation in ChatGPT | b0d33501-faa4-4a4e-801d-14955a93f2c2 | 192×108 JPEG repository preview; source render 1672×941 |
| hybrid-town-hall.jpg | approved hybrid Town Hall / economy | OpenAI image generation in ChatGPT | 358e348c-8b89-4c2b-bd64-51fc0cbf6bba | 192×108 JPEG repository preview; source render 1672×941 |
| hybrid-fortification.jpg | approved hybrid fortification / Tower engineering | OpenAI image generation in ChatGPT | 30a33938-8ec7-4995-9dbe-219a03c6b0d2 | 192×108 JPEG repository preview; source render 1672×941 |
| hybrid-sacred-site.jpg | approved hybrid Sacred Site | OpenAI image generation in ChatGPT | eae1fb02-e2ea-45f1-99d3-e39cc932b931 | 192×108 JPEG repository preview; source render 1672×941 |
| settlement-overview.webp | compact midgame settlement | OpenAI image generation in ChatGPT | e5e237d3-ef8e-42fe-a813-fae0ccf68c82 | resized/compressed to 1024×576 WebP |
| defense-engineering.webp | wall / gate / oversized defense engineering | OpenAI image generation in ChatGPT | c5ab6bdb-d3e3-4262-b3b8-ee307eb2290f | resized/compressed to 1024×576 WebP |
| compact-siege.webp | low-clutter siege readability | OpenAI image generation in ChatGPT | 3e197a19-db9a-4ccc-8bb1-9af99e3f1fc7 | resized/compressed to 1024×576 WebP |
| strategic-overview.webp | maximum zoom-out / information-first view | OpenAI image generation in ChatGPT | ccd415dd-b26b-45ac-b726-3101e3aa5d6b | resized/compressed to 1024×576 WebP |

## Generation context

Concepts были созданы из визуального brief проекта и предыдущих generated project references в этой же exploration-сессии.

В качестве raw source assets в эти repository files не импортировались изображения сторонних художников или marketplace assets.

Ранние WebP — оптимизированные derivatives исходных 1672×941 generated concepts.

Hybrid JPEG previews также происходят из 1672×941 generated source renders, но специально уменьшены для компактного хранения как documentation references. Source generation ids выше являются provenance link между repository preview и исходным generation event.

## Rights / production note

Факт генерации изображения сам по себе не является записью лицензии.

Перед коммерческим релизом production assets должны иметь отдельную provenance/rights запись согласно asset pipeline проекта и актуальным условиям используемых инструментов/источников.

Эти concept references не должны автоматически попадать в runtime build.
