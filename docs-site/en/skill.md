# Agent second-dev skill

Agents should rely on the in-repo skill plus contracts to avoid envelope/auth pitfalls.

## Entry points

- Full skill: [`skills/qingzhan-backend/SKILL.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/skills/qingzhan-backend/SKILL.md)
- Contracts: [`规则/api-contract-vben.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/规则/api-contract-vben.md) · [tech plan](https://github.com/xlhwkx/vben-nest-kit/blob/main/规则/vben-nestjs-backend-tech-plan.md)

## Minimal agent boot (summary)

1. Read API contract + tech plan (contract wins on conflict).
2. Skim `docs/qingzhan/architecture.md`; ops → deploy / backup / observability.
3. Code lands in `apps/server`; wire `apps/admin`; do not touch unrelated apps.
4. Scope a small slice and acceptance (paths / envelope / refresh exception / no password).
5. Local: `docker compose up -d` → Nest `:5320` → optional `pnpm dev:antd` `:5666` → health.
6. Review packet includes **skill path**, files changed, contract check, probes/tests.

## Hard rules

| Item | Value |
| --- | --- |
| Envelope | `{ code, data, error, message }`, success `code === 0` |
| refresh | `POST /api/auth/refresh` → **raw accessToken string** |
| Cookie | refresh cookie name **`jwt`** |
| Forbidden | returning **password** in responses |
| Public / Release | **explicit user OK only**; release workflow stays gated |

中文: [/skill](/skill)
