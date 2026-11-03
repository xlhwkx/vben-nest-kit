---
layout: home
hero:
  name: 青栈
  text: Nest 后端套件，对接 Vben
  tagline: 官方 Vue Vben Admin monorepo + 自研 NestJS（apps/server），用真实后端替换 backend-mock。
  image:
    src: /logo.svg
    alt: 青栈
  actions:
    - theme: brand
      text: 架构概览
      link: /architecture
    - theme: alt
      text: GitHub
      link: https://github.com/xlhwkx/vben-nest-kit
    - theme: alt
      text: English
      link: /en/
features:
  - title: 合同优先
    details: 真源在 规则/api-contract-vben.md 与技术方案；信封、Cookie jwt、refresh 纯字符串例外写死。
  - title: Nest + Prisma + Redis
    details: Nest 12 / Express、Prisma 7 + PostgreSQL、Redis、RBAC、accessMode backend、双前缀 /api 与 /api/v1。
  - title: 智能体友好
    details: skills/qingzhan-backend 二开 skill；docs/qingzhan 运维与架构摘要；切片提审门禁。
  - title: 企业稳态底座
    details: 限流、审计、健康探活、上传、可选 S3/队列骨架；部署与备份见 docs/qingzhan。
---

## 快速入口

| 内容 | 链接 |
| --- | --- |
| 架构摘要 | [architecture](/architecture)（正文复用 `docs/qingzhan/architecture.md`） |
| 生产部署 | [deploy](/deploy) |
| 智能体 Skill | [skill](/skill) |
| 仓内 Markdown 源 | [`docs/qingzhan/`](https://github.com/xlhwkx/vben-nest-kit/tree/main/docs/qingzhan) |
| API 合同 | [`规则/api-contract-vben.md`](https://github.com/xlhwkx/vben-nest-kit/blob/main/规则/api-contract-vben.md) |

## 本地预览本站

```bash
pnpm docs:dev
# 或：pnpm --filter @qingzhan/docs-site dev
```

构建：`pnpm docs:build`。GitHub Pages 说明见 [docs-site/README.md](https://github.com/xlhwkx/vben-nest-kit/blob/main/docs-site/README.md)（**Public 后**在仓库 Settings → Pages 启用 Actions）。
