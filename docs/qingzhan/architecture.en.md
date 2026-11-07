# Qingzhan architecture (summary)

> Implementation summary only — **does not replace** the source-of-truth contracts: `规则/vben-nestjs-backend-tech-plan.md`, `规则/api-contract-vben.md`.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | `apps/admin`: the only supported admin (Vue 3 + antdv-next), using backend permissions and the real API |
| Backend | NestJS 12 + Express (`apps/server` / `@qingzhan/server`) |
| ORM / DB | Prisma 7 + PostgreSQL |
| Cache / throttle store | Redis 7 (`ioredis`) |
| Auth | JWT Bearer + HttpOnly Cookie `jwt` (refresh); Argon2id |
| Throttle | `@nestjs/throttler` (Redis storage by default) |
| File storage | Local by default; optional S3-compatible (`STORAGE_DRIVER=s3`). Returned URLs depend on bucket policy or `S3_PUBLIC_URL`; local `/uploads` static is skipped when `s3` |
| Queue | Optional BullMQ skeleton (`QUEUE_ENABLED=false` by default) |
| Docs | Swagger `/api/docs` |

> **S3 URLs**: `put` returns `data.url` from `S3_PUBLIC_URL` (preferred) or `endpoint/bucket` / AWS default host. Browser-readable access still depends on bucket policy, CDN, or presigned URLs — not the string alone. With `STORAGE_DRIVER=s3`, the process does not mount local `UPLOAD_DIR` static assets.

## Dual prefix and envelope

- Alias: `/api/*`; versioned: `/api/v1/*`
- Success/error envelope `{ code, data, error, message }` (`code: 0` success)
- **Exception**: `POST /auth/refresh` body is a **raw accessToken string** (no envelope)

## Module map (backend)

Auth · User · Menu · System (user/role/menu/dept/dict) · Upload · Health · Audit

## Local ports

- Nest: `5320`
- Admin frontend: `5555` (`apps/admin`, Vite proxy → Nest)
- Compose Postgres / Redis: see `apps/server/.env.example`

## Cross-cutting (shipped highlights)

- **Swagger**: `http://localhost:5320/api/docs`; off in production unless `SWAGGER_ENABLED` forces it.
- **Throttling**: ~120 / 60s globally; stricter `POST /auth/login` (default 10 / 60s) → HTTP 429 envelope; Health skipped. Default `THROTTLE_STORAGE=redis`: login throttler is **fail-closed (503)** when Redis is down; other routes fail-open + warn. With `THROTTLE_STORAGE=memory`, in-process buckets are used (single-node rescue) and Redis fail-closed does **not** apply; `auth:fail` still uses Redis and is **fail-closed (HTTP 503 Login lock unavailable)** if Redis is down. Prefer redis in production.
- **Login fail lock**: `auth:fail:user:{username}` + `auth:fail:ip:{ip}` (default 5 / 15min → HTTP 429); successful login clears the username counter; complements IP QPS throttle.
- **Observability**: structured logs + `x-request-id`; `GET /api/health/metrics` (Prometheus, optional `METRICS_TOKEN`); OTel off by default (see [observability.md](./observability.md)).
- **Audit**: async `record` for login success/failure/lock, logout, sensitive writes, upload; list requires `System:Audit:List`; `x-request-id` header.
- **Upload**: local disk + UUID; MIME allow-list + **magic-bytes** (`file-type`); no SVG by default; `nosniff`; multer limit aligns with `UPLOAD_MAX_BYTES`.
- **Queue**: optional BullMQ skeleton (`QUEUE_ENABLED` default false); `MAIL_DRIVER=console|smtp` (console default, smtp dry-run). Runtime type `MailProvider` aliases tech-plan §26 `MailSender`.
- **Captcha tickets**: with `CAPTCHA_REQUIRED=true`, set `VITE_CAPTCHA_REQUIRED=true` in the admin to fetch a single-use public ticket before login. These tickets do not verify a human action. Production bypass is forbidden.

## Explicitly not done

- Production object-storage ops (optional MinIO Compose, lifecycle policies)
- Dedicated BullMQ worker process and live SMTP delivery (console/smtp dry-run skeleton present; no outbound by default)
- Browser authentication/security integration CI is defined for both UIs; execution and HTTPS acceptance of the production dist remain pending (see the acceptance runbook)
- OAuth / multi-tenant / full Clean Architecture

## Manual smoke (contract §11)

1. Root `pnpm install --frozen-lockfile`, migrate and explicitly seed a development DB, then `pnpm dev:admin` + Nest `:5320`
2. Open login, complete the slider and sign in as `vben` / `123456`; Qingzhan frontend configs reject E2E captcha bypass
3. Confirm menus; optional: shorten `JWT_ACCESS_TTL` and watch silent refresh

## See also

- Contributing: [contributing.en.md](./contributing.en.md)
- Tech plan: `规则/vben-nestjs-backend-tech-plan.md`
- API contract: `规则/api-contract-vben.md`
