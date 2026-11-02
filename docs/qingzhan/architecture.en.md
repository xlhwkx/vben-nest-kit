# Qingzhan architecture (summary)

> Implementation summary only — **does not replace** the source-of-truth contracts: `规则/vben-nestjs-backend-tech-plan.md`, `规则/api-contract-vben.md`.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vben Admin (web-antd), `accessMode: backend`, `VITE_NITRO_MOCK=false` |
| Backend | NestJS 12 + Express (`apps/server` / `@qingzhan/server`) |
| ORM / DB | Prisma 7 + PostgreSQL |
| Cache / throttle store | Redis 7 (`ioredis`) |
| Auth | JWT Bearer + HttpOnly Cookie `jwt` (refresh); Argon2id |
| Throttle | `@nestjs/throttler` (Redis storage by default) |
| Docs | Swagger `/api/docs` |

## Dual prefix and envelope

- Alias: `/api/*`; versioned: `/api/v1/*`
- Success/error envelope `{ code, data, error, message }` (`code: 0` success)
- **Exception**: `POST /auth/refresh` body is a **raw accessToken string** (no envelope)

## Module map (backend)

Auth · User · Menu · System (user/role/menu/dept/dict) · Upload · Health · Audit

## Local ports

- Nest: `5320`
- web-antd dev: `5666` (vite proxy → Nest)
- Compose Postgres / Redis: see `apps/server/.env.example`

## Cross-cutting (shipped highlights)

- **Swagger**: `http://localhost:5320/api/docs`; off in production unless `SWAGGER_ENABLED` forces it.
- **Throttling**: ~120 / 60s globally; stricter `POST /auth/login` (default 10 / 60s) → HTTP 429 envelope; Health skipped. Login throttler is **fail-closed (503)** when Redis is down; other routes stay fail-open + warn.
- **Login fail lock**: `auth:fail:user:{username}` + `auth:fail:ip:{ip}` (default 5 / 15min → HTTP 429); successful login clears the username counter; complements IP QPS throttle.
- **Audit**: async `record` for login success/failure/lock, logout, sensitive writes, upload; list requires `System:Audit:List`; `x-request-id` header.
- **Upload**: local disk + UUID; MIME allow-list + **magic-bytes** (`file-type`); no SVG by default; `nosniff`; multer limit aligns with `UPLOAD_MAX_BYTES`.

## Explicitly not done

- S3 / MinIO object storage switch
- BullMQ production job workers (not introduced yet)
- web-antd **SliderCaptcha** blocks headless UI login / silent-refresh automation
- Playwright (or similar) browser UI E2E; contract §11 UI checklist still open
- OAuth / multi-tenant / full Clean Architecture

## Manual smoke (contract §11)

1. Root `pnpm install`, then `pnpm dev:antd` + Nest `:5320`
2. Open login, **drag the slider**, sign in as `vben` / `123456`
3. Confirm menus; optional: shorten `JWT_ACCESS_TTL` and watch silent refresh

## See also

- Contributing: [contributing.en.md](./contributing.en.md)
- Tech plan: `规则/vben-nestjs-backend-tech-plan.md`
- API contract: `规则/api-contract-vben.md`
