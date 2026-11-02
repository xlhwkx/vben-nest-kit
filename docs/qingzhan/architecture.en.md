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
- web-antd dev: `5666` (vite proxy → Nest)
- Compose Postgres / Redis: see `apps/server/.env.example`

## Cross-cutting (shipped highlights)

- **Swagger**: `http://localhost:5320/api/docs`; off in production unless `SWAGGER_ENABLED` forces it.
- **Throttling**: ~120 / 60s globally; stricter `POST /auth/login` (default 10 / 60s) → HTTP 429 envelope; Health skipped. Default `THROTTLE_STORAGE=redis`: login throttler is **fail-closed (503)** when Redis is down; other routes fail-open + warn. With `THROTTLE_STORAGE=memory`, in-process buckets are used (single-node rescue) and Redis fail-closed does **not** apply; `auth:fail` still uses Redis and **fail-opens** (skips lock) if Redis is down. Prefer redis in production.
- **Login fail lock**: `auth:fail:user:{username}` + `auth:fail:ip:{ip}` (default 5 / 15min → HTTP 429); successful login clears the username counter; complements IP QPS throttle.
- **Audit**: async `record` for login success/failure/lock, logout, sensitive writes, upload; list requires `System:Audit:List`; `x-request-id` header.
- **Upload**: local disk + UUID; MIME allow-list + **magic-bytes** (`file-type`); no SVG by default; `nosniff`; multer limit aligns with `UPLOAD_MAX_BYTES`.
- **Queue**: optional BullMQ skeleton (`QUEUE_ENABLED` default false); `MAIL_DRIVER=console|smtp` (console default, smtp dry-run). Runtime type `MailProvider` aliases tech-plan §26 `MailSender`.
- **Captcha**: production UI keeps web-antd **SliderCaptcha**; API does not require captcha by default (contract). `CAPTCHA_REQUIRED=true` enforces tokens from `GET /api/auth/captcha`; frontend `VITE_CAPTCHA_REQUIRED=true` makes `loginApi` fetch and send `captchaId`+`captchaToken`. `CAPTCHA_E2E_BYPASS=1` + `VITE_CAPTCHA_E2E_BYPASS` are test-only (never production).

## Explicitly not done

- Production object-storage ops (optional MinIO Compose, lifecycle policies)
- Dedicated BullMQ worker process and live SMTP delivery (console/smtp dry-run skeleton present; no outbound by default)
- Full Playwright UI E2E still optional; SliderCaptcha has an E2E bypass harness
- OAuth / multi-tenant / full Clean Architecture

## Manual smoke (contract §11)

1. Root `pnpm install`, then `pnpm dev:antd` + Nest `:5320`
2. Open login, **drag the slider**, sign in as `vben` / `123456` (or set `VITE_CAPTCHA_E2E_BYPASS=true` for local/E2E only)
3. Confirm menus; optional: shorten `JWT_ACCESS_TTL` and watch silent refresh

## See also

- Contributing: [contributing.en.md](./contributing.en.md)
- Tech plan: `规则/vben-nestjs-backend-tech-plan.md`
- API contract: `规则/api-contract-vben.md`
