# 青栈 v0.1.0 Release Notes（草稿）

> **状态：草稿** — 尚未 `git tag`，尚未 `gh release create`。确认后可用本页正文发 GitHub Release。  
> 变更明细见仓库根 [`CHANGELOG.qingzhan.md`](../../CHANGELOG.qingzhan.md)。  
> 基线 commit（文档刀）：`3f08a05`；含本草稿的提交以 push 后 HEAD 为准。

## 中文（短）

**青栈 v0.1.0** 是第一版可联调的 Nest 后端，替换 Vben `backend-mock`，让 `web-antd` 以 `accessMode: backend` 打真实 API。

**包含：** Auth（login / refresh 纯字符串 / logout / codes）、用户信息与动态菜单、System 用户/角色/菜单/部门/字典、本地上传（默认禁 SVG）、Health live/ready、Swagger、审计日志与管理列表、全局限流（登录更严）、双前缀 `/api`+`/api/v1`、E2E 最小套件、中英架构与贡献文档。

**已知缺口（不挡草稿，发正式版前建议知情）：** Upload magic-bytes、`auth:fail` 锁定、浏览器 UI E2E、S3/MinIO、BullMQ、OAuth/多租户。

**发版提醒：** `apps/server` 版本已是 `0.1.0`；根 monorepo 保持上游 `5.7.0`。打 tag 前请再跑 `pnpm --filter @qingzhan/server test:e2e` 与合同 §11 抽检。

## English (short)

**Qingzhan v0.1.0** is the first Nest backend drop that replaces Vben `backend-mock` so `web-antd` can run with `accessMode: backend`.

**Ships:** Auth (login / raw-string refresh / logout / codes), user info + role menus, System CRUD (user/role/menu/dept/dict), local upload (SVG off by default), health live/ready, Swagger, audit log + admin list, global + stricter login throttle, dual `/api`+`/api/v1`, minimal e2e, bilingual architecture/contributing docs.

**Known gaps:** upload magic-bytes, `auth:fail` lockout, browser UI E2E, S3/MinIO, BullMQ, OAuth/multi-tenant.

**Release note:** `@qingzhan/server` is already `0.1.0`; root stays upstream `5.7.0`. **No tag / no GitHub Release yet** — confirm with the maintainer first.

## 建议的 `gh release` 命令（确认后再跑）

```bash
# 在仓库根；先确认 CHANGELOG / notes 已合入 main
git tag -a v0.1.0 -m "qingzhan v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --title "青栈 / Qingzhan v0.1.0" --notes-file docs/qingzhan/release-notes-v0.1.md
```

（当前**不要**执行上述命令，除非用户明确批准。）
