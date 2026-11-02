# 青栈开源检查清单（Open-source checklist）

面向把本仓库（或抽出的 `apps/server` + `规则/`）以 **MIT** 公开前的自检。真源仍是 `规则/`；本页不替代合同。

> English summary: MIT license already present; scrub secrets before `public`; server e2e CI is `.github/workflows/qingzhan-server-e2e.yml`; GitHub Release / visibility change still needs an explicit human OK.

## 已具备

- [x] 根目录 **MIT** `LICENSE`
- [x] `.env` / `apps/server/.env` / `uploads/` 已在 `.gitignore`
- [x] 提交物不含真实 JWT / Redis 生产密码（仅 `.env.example` 占位）
- [x] 青栈文档：`docs/qingzhan/`（架构 / 贡献 / 本清单）
- [x] 服务端 e2e workflow：`.github/workflows/qingzhan-server-e2e.yml`（Compose PG+Redis；随机 JWT；`ignore-workspace`）
- [x] 上游 Vben Issue / PR 模板仍在 `.github/`（可沿用）

## 公开前必做

1. **轮换示例密钥**：确认从未把真实 `JWT_*` / `REDIS_PASSWORD` / 云厂商密钥推进 git 历史；公开前轮换一切曾在私有环境用过的密钥。
2. **仓库可见性**：改为 `public` **须仓库所有者确认**（开发/审查机器人不擅自改）。
3. **README 徽章**：按需加 CI badge 指向 `qingzhan-server-e2e`；勿链到仍 private 的检查。
4. **GitHub Release**：`v0.1.0` tag 已存在；建 Release / 上传 notes **仍须用户点头**（见 `docs/qingzhan/release-notes-v0.1.md`）。
5. **扫一遍敏感文件**：`git grep -iE 'password|secret|api[_-]?key' -- ':!.env.example' ':!apps/server/.env.example' ':!规则' ':!docs' ':!**/seed.ts'`，排除演示账密说明。

## 已知缺口（公开说明即可，勿写成已交付）

| 项 | 说明 |
|----|------|
| SliderCaptcha | web-antd 登录滑块阻碍 headless UI E2E / 静默 refresh 自动化勾选 |
| 浏览器 §11 | Playwright 等 UI E2E 未做；人工冒烟见 architecture |
| S3 / MinIO | 可选 `STORAGE_DRIVER=s3` 骨架已有；默认仍 local |
| BullMQ | 可选骨架已有（默认关）；独立 worker / 真业务未接 |
| OAuth / 多租户 | 未做 |
| 全 monorepo CI | 上游 `ci.yml` 仍绑定 `vbenjs/vue-vben-admin`；前端 CI 另议 |
| `apps/server` lockfile | `pnpm-lock.yaml` gitignore（workspace 用根 lock）；server-only CI 非 frozen |

## 建议（可选）

- Issues：沿用 `.github/ISSUE_TEMPLATE`，或加「青栈后端」标签说明
- SECURITY.md：说明漏洞私下联系方式
- 贡献指南：`docs/qingzhan/contributing.md` 已链真源与 E2E

## 相关链接

- 架构：[architecture.md](./architecture.md)
- Changelog：[CHANGELOG.qingzhan.md](../../CHANGELOG.qingzhan.md)
- Workflow：`.github/workflows/qingzhan-server-e2e.yml`
