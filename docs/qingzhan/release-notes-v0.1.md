# 青栈 v0.1.0 Release Notes

> 变更明细见仓库根 [`CHANGELOG.qingzhan.md`](../../CHANGELOG.qingzhan.md)。  
> 基线：annotated tag **`v0.1.0`**（以 tag 所指 commit 为准）。  
> 仓库当前为 **private**，**暂不创建 GitHub Release**。

## 中文（短）

**青栈 v0.1.0** 是第一版可联调的 Nest 后端，替换 Vben `backend-mock`，让 `web-antd` 以 `accessMode: backend` 打真实 API。

**包含：** Auth（login / refresh 纯字符串 / logout / codes）、用户信息与动态菜单、System 用户/角色/菜单/部门/字典、本地上传（默认禁 SVG）、Health live/ready、Swagger、审计日志与管理列表、全局限流（登录更严）、双前缀 `/api`+`/api/v1`、E2E 最小套件、中英架构与贡献文档。

**Seed 演示账号：** `vben` / `admin` / `jack`（密码均为 `123456`）。

**Known gaps：** Upload magic-bytes、`auth:fail` 锁定、浏览器 UI E2E、S3/MinIO、BullMQ、OAuth/多租户。

**发版说明：** `apps/server` 版本已是 `0.1.0`；根 monorepo 保持上游 `5.7.0`。已打 `v0.1.0` tag；private 仓暂不建 GitHub Release。

## English (short)

**Qingzhan v0.1.0** is the first Nest backend drop that replaces Vben `backend-mock` so `web-antd` can run with `accessMode: backend`.

**Ships:** Auth (login / raw-string refresh / logout / codes), user info + role menus, System CRUD (user/role/menu/dept/dict), local upload (SVG off by default), health live/ready, Swagger, audit log + admin list, global + stricter login throttle, dual `/api`+`/api/v1`, minimal e2e, bilingual architecture/contributing docs.

**Seed accounts:** `vben` / `admin` / `jack` (password `123456` each).

**Known gaps:** upload magic-bytes, `auth:fail` lockout, browser UI E2E, S3/MinIO, BullMQ, OAuth/multi-tenant.

**Release note:** `@qingzhan/server` is already `0.1.0`; root stays upstream `5.7.0`. Annotated tag **`v0.1.0`** is pushed; **no GitHub Release** while the repo stays private.

