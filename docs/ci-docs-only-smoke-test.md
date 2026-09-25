# Docs-only CI smoke-test

Этот временный документ создан только для проверки классификации docs-only изменений в GitHub Actions.

Ожидаемое поведение:

- `changes` определяет PR как docs-only;
- тяжёлые jobs (`lint`, `typecheck`, `unit-tests`, `simulation-tests`, `server-integration`, `build`) пропускаются;
- `ci-gate` завершается успешно;
- PR после проверки закрывается без merge.
