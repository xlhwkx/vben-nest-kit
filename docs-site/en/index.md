---
layout: home
hero:
  name: Qingzhan
  text: Nest backend kit for Vben
  tagline: Official Vue Vben Admin monorepo + first-party NestJS (apps/server) replacing backend-mock with a real API.
  image:
    src: /logo.svg
    alt: Qingzhan
  actions:
    - theme: brand
      text: Architecture
      link: /en/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/xlhwkx/vben-nest-kit
    - theme: alt
      text: 中文
      link: /
features:
  - title: Contract first
    details: Source of truth under 规则/api-contract-vben.md — envelope, Cookie jwt, refresh raw-string exception.
  - title: Nest + Prisma + Redis
    details: Nest 12 / Express, Prisma 7 + PostgreSQL, Redis, RBAC, accessMode backend, dual prefix /api and /api/v1.
  - title: Agent-friendly
    details: skills/qingzhan-backend second-dev skill; docs/qingzhan ops notes; slice review gate for maintainers.
  - title: Steady baseline
    details: Throttle, audit, health, upload, optional S3/queue skeletons; deploy & backup under docs/qingzhan.
---

## Quick links

| Topic | Link |
| --- | --- |
| Architecture | [architecture](/en/architecture) (includes `docs/qingzhan/architecture.en.md`) |
| Deploy | [deploy](/en/deploy) |
| Agent skill | [skill](/en/skill) |
| Markdown source | [`docs/qingzhan/`](https://github.com/xlhwkx/vben-nest-kit/tree/main/docs/qingzhan) |
| API contract | [`规则/api-contract-vben.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/规则/api-contract-vben.md) |

## Preview locally

```bash
pnpm docs:dev
```

Build with `pnpm docs:build`. GitHub Pages: see [docs-site/README.md](https://github.com/xlhwkx/vben-nest-kit/blob/main/docs-site/README.md) — enable Actions Pages **after** the repo is Public.
