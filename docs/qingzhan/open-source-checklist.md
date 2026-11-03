# 青栈开源检查清单（Open-source checklist）

面向把本仓库（或抽出的 `apps/server` + `规则/`）以 **MIT** 公开前的自检。真源仍是 `规则/`；本页不替代合同。

> English summary: MIT license already present; scrub secrets before `public`; server e2e CI is `.github/workflows/qingzhan-server-e2e.yml`; **GitHub visibility / Release still need an explicit human OK** — bots never flip Public or run `gh release create`.

## 发布态勾选（Publish readiness）

### A. 已具备（代码/文档）

- [x] 根目录 **MIT** `LICENSE`
- [x] `.env` / `apps/server/.env` / `uploads/` 已在 `.gitignore`
- [x] 提交物不含真实 JWT / Redis 生产密码（仅 `.env.example` 占位）
- [x] 青栈文档：`docs/qingzhan/`（架构 / 贡献 / 本清单 / 字段对账）
- [x] 服务端 e2e workflow：`.github/workflows/qingzhan-server-e2e.yml`
- [x] Captcha harness + MailProvider/MailSender 骨架（默认不接真服务）
- [x] v0.1 / v0.2 Release notes 草稿（见下）
- [x] 发版 workflow **草稿**（默认禁用）：`.github/workflows/qingzhan-release.yml`

### B. 公开前必做（人工）

- [x] **轮换密钥**：确认 git 历史无真实 `JWT_*` / `REDIS_PASSWORD` / 云厂商密钥；公开前轮换曾用过的密钥
- [x] **敏感扫描**：`git grep -iE 'password|secret|api[_-]?key' -- ':!.env.example' ':!apps/server/.env.example' ':!规则' ':!docs' ':!**/seed.ts'`
- [x] **README 徽章**：按需加 CI badge（仅指向已对访客可见的检查）
- [x] **LICENSE / 第三方归属**：确认上游 Vben 说明仍可发现（`README.vben.md`）
- [ ] **仓库可见性 → Public**：须仓库所有者确认（开发/审查机器人不擅自改）
- [ ] **GitHub Release**：创建 Release / 上传 notes 须用户点头（可用草稿 notes，勿自动 publish）

#### B 自扫结论（2026-11-03，Asia/Singapore）

| 检查 | 结果 |
|------|------|
| 入库 `.env` / `apps/server/.env` | 未跟踪；仅有 `.env.example`；`git log --all --full-history` 无真 `.env` 落盘 |
| 高熵密钥（AKIA / PEM / ghp_ / sk_live_） | 工作区与抽样历史 **无命中** |
| JWT / Redis | 仅 `change-me-*-qingzhan` 占位 + 本地 demo `qingzhan`；e2e workflow 运行时 `openssl rand` |
| Demo 账密 | `vben`/`123456` 等合同/seed 明文，**文档约定非生产密钥** |
| 工作区 password/secret/api_key 命中 | 多为字段名、GitHub Actions secrets 引用、mock 硬编码占位、测试断言 — 非生产密钥 |
| 轮换 | **git 侧无需轮换**（历史无真密钥）。上线生产仍须自备强 JWT/DB/Redis，禁沿用 example |

> **官网 / VitePress**：独立文档站（GitHub Pages + VitePress）为 **另刀交付**；Pages 需仓库 **Public** 后对访客生效。仓内 `docs/qingzhan/` Markdown + README 已够开源首发，**官网不是开源硬门槛**。

### C. 发版建议顺序

1. 勾完 **B** 敏感项
2. 用户明确说「改 Public」→ 再改可见性
3. 用户明确说「打 Release / 发 vX.Y.Z」→ 再 `gh release create` 或启用 `qingzhan-release.yml` 的 publish 输入
4. 默认保持 private + 无 GitHub Release

## 已知缺口（公开说明即可，勿写成已交付）

| 项 | 说明 |
|----|------|
| SliderCaptcha | 旁路：`VITE_CAPTCHA_E2E_BYPASS` + `CAPTCHA_E2E_BYPASS`；强制：`CAPTCHA_REQUIRED` + 前端 `VITE_CAPTCHA_REQUIRED` 拉票 |
| 浏览器 UI E2E | Playwright 整页未做；人工冒烟见 architecture |
| S3 / MinIO | 可选 `STORAGE_DRIVER=s3` 骨架；默认 local |
| BullMQ / 真邮件 | `MailProvider`（= tech plan `MailSender`）console / smtp dry-run；独立 worker / 真 SMTP 未接 |
| OAuth / 多租户 | 未做 |
| 全 monorepo CI | 上游 `ci.yml` 仍绑 `vbenjs/vue-vben-admin`；青栈以 `qingzhan-server-e2e` 为准 |

## 相关链接

- 架构：[architecture.md](./architecture.md)
- Changelog：[CHANGELOG.qingzhan.md](../../CHANGELOG.qingzhan.md)
- v0.1 notes：[release-notes-v0.1.md](./release-notes-v0.1.md)
- v0.2 notes（草稿）：[release-notes-v0.2.0.md](./release-notes-v0.2.0.md)
- Workflow：`.github/workflows/qingzhan-server-e2e.yml` · 发版草稿 `.github/workflows/qingzhan-release.yml`
