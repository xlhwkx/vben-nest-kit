# 青栈 v0.2.0 Release Notes（草稿）

> 变更明细见 [`CHANGELOG.qingzhan.md`](../../CHANGELOG.qingzhan.md) **Unreleased**。  
> **未打 tag、未创建 GitHub Release**。公开仓 / Release 须用户点头。  
> 建议 tag：`v0.2.0`（仅在用户确认后由人工或启用 `qingzhan-release.yml`）。

## 中文（短）

**青栈 v0.2.0（候选）** 在 v0.1 可联调基线上补齐合同演示类路径、字段级对账、安全加固与开源准备骨架。

**本候选包含：**

- 合同 P2：`/api/table/list`、`/api/status`、`/api/timezone/*`、可选 `/api/demo/bigint`；`/api/test` → health 替代说明
- 运行时字典 `/api/dict/*` e2e；system 列表日界 **Asia/Shanghai**；user 创建 username+password、`createTime` ISO；role 部分更新 / code 可选；playground 角色多选与名称展示
- 登录失败锁定、上传 magic-bytes、限流 fail-closed（登录）
- M4 骨架：`StorageProvider`（local/s3）、BullMQ 队列占位、`MailProvider`/`MailSender`（console / smtp dry-run）
- Captcha harness：`GET /api/auth/captcha`；默认不强制；`VITE_CAPTCHA_REQUIRED` 前端拉票接线；E2E 旁路
- CI：`qingzhan-server-e2e`；`IGNORE_STUB` + allowBuilds；开源清单与本草稿

**仍不做（除非用户另点）：** 仓库 Public、GitHub Release、真 SMTP、真 S3 生产运维、Playwright 整页。

## English (short)

**Qingzhan v0.2.0 (candidate)** builds on v0.1 with contract demo routes, field parity, hardening, and open-source prep skeletons.

**Highlights:** P2 table/status/timezone/bigint; dict runtime; Shanghai day-bounds; user/role form parity; login lockout; upload magic-bytes; storage/queue/mail skeletons; captcha harness + optional frontend ticket wiring; server e2e CI; open-source checklist.

**Not included until explicit OK:** repo Public, GitHub Release, live SMTP, production S3 ops, full Playwright UI E2E.

## 发版检查（人工）

- [ ] 对照 `docs/qingzhan/open-source-checklist.md` 勾完「公开前必做」
- [ ] 用户确认 tag 名（建议 `v0.2.0`）与是否 bump `@qingzhan/server` package version
- [ ] 用户确认后才：改 Public / `gh release create` / 打开 workflow publish
