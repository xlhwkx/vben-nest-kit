# 青栈文档（Qingzhan）

本目录记录青栈单管理端（`apps/admin`）与 Nest 后端（`apps/server`）的架构、开发与验收。产品文档站为 `docs-site`，上游组件文档请查阅 https://doc.vben.pro。

| 文档 | 中文 | English |
| --- | --- | --- |
| 架构 | [architecture.md](./architecture.md) | [architecture.en.md](./architecture.en.md) |
| 贡献指南 | [contributing.md](./contributing.md) | [contributing.en.md](./contributing.en.md) |
| 单前端迁移 | [single-admin-migration.md](./single-admin-migration.md) | — |
| 生产部署 | [deploy.md](./deploy.md) | — |
| 生产交付与验收 | [production-acceptance.md](./production-acceptance.md) | — |
| 第十三轮交付记录 | [production-delivery-phase13-2026-11-07.md](./production-delivery-phase13-2026-11-07.md) | — |
| 备份/迁移演练 | [backup-migrate.md](./backup-migrate.md) | — |
| 可观测性 | [observability.md](./observability.md) | — |
| v0.1 发版说明（草稿） | [release-notes-v0.1.md](./release-notes-v0.1.md) | same |
| v0.2 发版说明（草稿） | [release-notes-v0.2.0.md](./release-notes-v0.2.0.md) | same |
| 开源检查清单 | [open-source-checklist.md](./open-source-checklist.md) | EN summary in-page |
| 智能体二开 skill | [../../skills/qingzhan-backend/SKILL.md](../../skills/qingzhan-backend/SKILL.md) | — |

## 真源（勿搬迁）

接口与选型仍以仓库根 `规则/` 为准：

- `规则/vben-nestjs-backend-tech-plan.md` — 技术方案
- `规则/api-contract-vben.md` — API 合同

改路径 / 信封 / Cookie 前先读合同，再改代码。

## Changelog

- 青栈变更：仓库根 [`CHANGELOG.qingzhan.md`](../../CHANGELOG.qingzhan.md)（不覆盖上游各包 CHANGELOG）

## 产品文档站

VitePress 站在仓库 [`docs-site/`](../../docs-site/)（复用本目录 Markdown）。本地：`pnpm docs:dev`。GitHub Pages 见 `docs-site/README.md`（**Public 后**启用）。Logo：[`logo.svg`](./logo.svg)。
