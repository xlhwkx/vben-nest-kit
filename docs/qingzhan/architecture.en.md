# Qingzhan Architecture Overview

> 中文：[architecture.md](./architecture.md)

## Purpose

Qingzhan replaces Vben's official `apps/backend-mock` (Nitro mock) with a real Nest backend so `apps/web-antd` can run with `accessMode: 'backend'`.

Primary deliverable: **`apps/server`** (`@qingzhan/server`) inside the monorepo. Frontend packages remain upstream Vben. Normative specs live under `规则/`; this page is a readable summary **and does not replace the contract**.

## Stack (as implemented)

| Layer | Choice |
|-------|--------|
| HTTP | NestJS 12 + Express (`@nestjs/platform-express`) |
| ORM / DB | Prisma 7 + PostgreSQL 16 |
| Cache / throttle store | Redis 7 (`ioredis`) |
| Auth | JWT access (Bearer) + refresh (HttpOnly Cookie named `jwt`) |
| Passwords | Argon2id |
| Authorization | RBAC; frontend `accessMode: 'backend'`; codes from `GET /auth/codes` |
| Docs | Swagger UI at `/api/docs` (on by default outside production) |
| Rate limit | `@nestjs/throttler` (Redis storage by default) |

## API conventions (summary)

- **Dual prefix**: routes mount on both `/api` (mock-compatible) and `/api/v1`.
- **Envelope**: `{ code, data, message, error }`; success when `code === 0`.
- **Sole exception**: `POST /auth/refresh` returns a **raw accessToken string** (no envelope), matching the frontend `baseRequestClient`.
- **Auth**: Bearer access for APIs; refresh/logout use Cookie `jwt` with CORS credentials.
- **Never** include `password` on successful user payloads.

Full path/field tables: `规则/api-contract-vben.md`.

## Module map (`apps/server/src`)

| Module | Role |
|--------|------|
| `auth` | login / refresh / logout / codes |
| `user` | `GET /user/info`, etc. |
| `menu` | `GET /menu/all` |
| `system` | admin CRUD for users/roles/menus/depts/dicts |
| `upload` | local upload; static `/uploads`; SVG disabled by default |
| `audit` | `AuditLog` + `GET /system/audit/list` |
| `health` | `/health`, `/health/live`, `/health/ready` (ready checks PG+Redis) |
| `common` / `prisma` / `redis` | cross-cutting helpers |

## Local ports (see `.env.example` / Compose)

| Service | Usual value |
|---------|-------------|
| Nest `APP_PORT` | **5320** |
| Postgres host port | **55433** (5432 in container) |
| Redis host port | **56379** (6379 in container; Compose sets `requirepass`) |
| web-antd dev | **5666**; proxy `/api` → `http://localhost:5320/api` |

From repo root: `docker compose up -d`.

## Cross-cutting (shipped highlights)

- **Swagger**: `http://localhost:5320/api/docs`; off in production unless `SWAGGER_ENABLED` forces it.
- **Throttling**: ~120 / 60s globally; stricter `POST /auth/login` (default 10 / 60s) → HTTP 429 envelope; Health skipped.
- **Audit**: async `record` for login success/failure, logout, sensitive writes, upload; list requires `System:Audit:List`; `x-request-id` header.
- **Upload**: local disk + UUID names; MIME allow-list; static `nosniff`.

## Explicitly not done

- S3 / MinIO object storage switch
- BullMQ production job workers
- Playwright (or similar) browser UI E2E; contract §11 UI checklist still open
- Redis `auth:fail:{user|ip}` lockout (complementary to IP throttle)
- OAuth / multi-tenant / full Clean Architecture

## See also

- Contributing: [contributing.en.md](./contributing.en.md)
- Tech plan: `规则/vben-nestjs-backend-tech-plan.md`
- API contract: `规则/api-contract-vben.md`
