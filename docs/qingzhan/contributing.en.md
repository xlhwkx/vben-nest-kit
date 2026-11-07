# Qingzhan Contributing Guide

> 中文：[contributing.md](./contributing.md)

## Read the contract before changing APIs

1. `规则/api-contract-vben.md` — paths, methods, envelope, Cookie `jwt`, Bearer, refresh raw-string exception, no `password` in responses.
2. `规则/vben-nestjs-backend-tech-plan.md` — stack choices and milestones.

Verbal agreements do **not** override the contract. If a field must change, update `规则/` first, then code, and call it out in the PR.

Architecture summary: [architecture.en.md](./architecture.en.md).

## Branching and PRs

- Branch from latest `main`; prefer small, reviewable slices.
- PR description: which routes/modules changed, how you tested, whether the contract moved.
- Do **not** force-push shared branches; do **not** commit `.env`, secrets, user `uploads/`, or local log dumps.
- Open-source contributors: use the PR checklist below. This team also uses paired review in chat (dev slice → reviewer gate); that does not replace CI or the contract.

## Local setup

```bash
cp .env.example .env
docker compose up -d
```

Usual host ports: Postgres **55433**, Redis **56379**, Nest **5320** (see `.env.example`).

### Install

Prefer the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @qingzhan/server start:dev
```

For backend-only development, use the workspace filter from the repository root, keeping the root lockfile and build allowlist:

```bash
IGNORE_STUB=1 pnpm install --frozen-lockfile --filter @qingzhan/server...
pnpm --filter @qingzhan/server exec prisma migrate deploy
ALLOW_DEMO_SEED=true pnpm --filter @qingzhan/server exec prisma db seed
pnpm --filter @qingzhan/server start:dev
```

`apps/server/pnpm-lock.yaml` is gitignored; workspace installs use the root lockfile.

### E2E

```bash
cd apps/server
pnpm test:e2e
```

Requires Compose + `.env` + seed. Node engines: `^22.18 || ^24.12` (tests use `--experimental-vm-modules`). See `apps/server/README.md`.

### Frontend wiring

Repo already sets `VITE_NITRO_MOCK=false`, `accessMode: 'backend'`, and proxy to Nest. Clear localStorage after preference changes.

Use `pnpm dev:admin` for the management pages (playground, http://localhost:5555). `pnpm dev:antd` provides the other UI integration example (http://localhost:5666). Clean machines need a full root `pnpm install --frozen-lockfile`, including postinstall stubs. If `@vben/vite-config` cannot resolve, finish installing and run `pnpm -r run --if-present stub`. See the root README for setup and the [acceptance runbook](./production-acceptance.md) for delivery commands and evidence requirements.

## Safety

- Never commit `.env`, real JWT secrets, or production connection strings.
- Keep upload artifacts and local logs gitignored.
- Responses and audit details must not leak password or raw refresh tokens.
- Destructive actions (drop DB, force-push, rotate prod secrets) need maintainer approval first.

## Suggested checklist

- [ ] Dual prefix `/api` and `/api/v1` still work
- [ ] Envelope `code === 0`; refresh remains a raw string
- [ ] No password leakage; auth / permission codes behave as expected
- [ ] `pnpm test:e2e` (or relevant unit tests) pass
- [ ] No drive-by upstream Vben edits; Markdown fences are plain and unbroken
