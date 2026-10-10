# Предложение для review: Spec #002 §8.8 / ADR-008

Статус: **предложение, не принятое архитектурное решение**. Issue #87 не меняет approved query-count budgets.

Adversarial 256×256 topology churn делает восемь active destinations и восемь synthetic AI targets unreachable. Даже после устранения repeated blocked-component discovery остаётся 536 416 A* expansions в одном full tick; measured p95 больше 100 ms (см. README/JSON). Query caps 16 command / 8 active / 8 AI не ограничивают visits/expansions.

Следующий отдельный issue/spec review должен определить deterministic work units (например, label visits, projection candidates, A* expansions и smoothing checks) и их распределение по независимым lanes. Не выбирать лимиты по одному Apple M1 timing; нужны workload matrix, поддерживаемый hardware baseline и headroom.

Если cap не помещает atomic group planning в один tick, требуется явный контракт resumable search: FIFO/fairness, reservation lifecycle, latency, сохранение validation/authorization и atomic commit только после успешного планирования всех units. Нужно определить invalidation/resume при topology revision changes, cancellation/replacement MOVE, bounded retained search memory и starvation protection. Для active tasks следует согласовать ожидание при unsafe segment; для AI — ascending identity/max-one-query policy. Решения должны оставаться fixed-tick deterministic, без wall-clock gameplay timers.

До реализации обновить Spec #002 §8.8 и ADR-008 через independent review и согласование maintainers. Новый work budget/resumable algorithm в #87 не внедряется. Connected-component early rejection exact unreachable targets можно отдельно измерить как более узкую оптимизацию; она также не даёт общего CPU bound для сложных reachable routes/smoothing и не заменяет решение бюджета.
