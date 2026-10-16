---
id: "branch-naming-gate"
title: "Имена task branches: быстрый CI gate"
component: "workflow"
tags: ["branch", "worktree", "ci", "handoff"]
context: "Перепроверено в AT7 #107 (2026-10-14): naming jobs не изменены, 30 validator tests PASS; применимость зависит от fingerprints sources и текущих ADR/spec."
status: "verified"
issues: ["https://github.com/Web-Usov/web-rts/issues/89"]
prs: ["https://github.com/Web-Usov/web-rts/pull/90"]
commits: ["https://github.com/Web-Usov/web-rts/commit/9507da838f6519c1ce3b0f05e3ddbf20170a8bfc"]
sources: ["scripts/validate-branch-name.mjs@3c4c5aeb8a30b1208f9ddcd7739963a6b653af6b6bb323ac7ffd276420f41b21", "scripts/validate-branch-name.test.mjs@1b71757d3ef71e4f33a8c2a5f28b3a7586cb4e222ee3846423a3221404a0ad9c", "docs/agentic-workflow.md@cc25cc977788ca5ff9032a8c84bff21d401e67bc409de03a244ee2a46b08ee0e", ".github/workflows/ci.yml@61a37b0a63372984eb3fb942273a9084b1a6881eeabe5e865dbef53b29d5d658", "AGENTS.md@47c9a103126cec1e005ac75b5f7e6495b3e845f6560c74fb125da1d78ea5bfe1"]
---
# Имена task branches: быстрый CI gate

## Симптом

Implementation handoff должен задавать согласованные branch/worktree names; неправильно названный PR блокируется branch-name → ci-gate, включая docs-only PR.

## Причина

Issue #89 закрепил ранее несогласованный naming workflow. Это workflow improvement, а не выдуманный runtime incident: PR #90 добавил валидатор и отдельный job с positive/negative tests.

## Решение

Использовать feature|fix|doc|chore/<stage>-<issue>[-description], <issue>[-description] либо <description>, lowercase/kebab-case. Stage брать из issue/spec. Worktree с issue: web-rts_<stage>-<issue> либо web-rts_<issue>, без type/description. Существующие branches/worktrees не переименовываются; сначала проверить наличие.

## Проверка

`node scripts/validate-branch-name.mjs feature/at2-102` даёт exit 0; `node scripts/validate-branch-name.mjs feature/AT2-102` даёт exit 1. `node --test scripts/validate-branch-name.test.mjs` проверяет допустимые prefixes и malformed stage/issue pairs. Проверить branch-name и ci-gate в .github/workflows/ci.yml: push main skipped допустим, на PR naming job обязан success. Handoff и Project Status Check описаны в docs/agentic-workflow.md.

## Ограничения

GitHub Actions блокирует merge через required gate, но не создание ref/push. Не менять branch protection без отдельной задачи. Project Status Check Required/Not required обязателен, transient SHA/CI в checkpoint не пишутся. Перед новым task проверить актуальный AGENTS.md: note не переопределяет naming contract.
