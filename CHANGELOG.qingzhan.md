# 青栈 Changelog

> 本文件只记录 **青栈（Qingzhan）** 相对上游 Vben Admin 的后端与联调变更。  
> 上游各包自带的 `CHANGELOG.md`（如 `apps/web-antd`、`packages/*`）**不要改写本文件、也不被本文件覆盖**。

## [0.1.0] — 2026-11-02

HEAD（草稿基线）：`3f08a05`（文档刀通过后；本 Release 草稿提交会再前进一格）。  
包版本：`apps/server` / `@qingzhan/server` = `0.1.0`。根 monorepo 仍为上游 `5.7.0`，未 bump。

### Added

- NestJS 12 + Express 后端骨架 `apps/server`（`@qingzhan/server`），Prisma 7 + PostgreSQL、Redis、Docker Compose
- Auth P0：`login` / `refresh` / `logout` / `codes`；JWT Bearer + HttpOnly Cookie `jwt`；Argon2id；Prisma seed（vben / jack）
- `GET /user/info`、`GET /menu/all`（按角色树）
- System 管理端：用户 / 角色 / 菜单 / 部门 / 字典 CRUD（含 RoleMenu、UserRole、软删 tombstone）
- 本地 Upload：`POST /upload`、静态 `/uploads`、MIME 白名单、UUID 文件名
- Health：`/health`、`/health/live`、`/health/ready`（ready 探测 PG + Redis）
- Swagger：`/api/docs`（非 production 默认开；可用 `SWAGGER_ENABLED`）
- Audit：`AuditLog` 落库（登录成功/失败、logout、敏感写、upload）+ `GET /system/audit/list`（`System:Audit:List`）+ `x-request-id`
- 全局限流 + 登录更严（`@nestjs/throttler`，默认 Redis storage）→ HTTP 429 信封
- 双前缀 `/api` + `/api/v1`；统一成功/错误信封（refresh 纯字符串例外）
- web-antd 联调配置：`VITE_NITRO_MOCK=false`、`accessMode: 'backend'`、dev proxy → Nest `:5320`
- E2E 最小套件（auth / health / refresh / logout / audit 403 / upload 缺 file）
- 中英文档：`docs/qingzhan/` 架构 + 贡献指南

### Changed

- Cookie `maxAge` 改为毫秒；去掉未使用的 passport 依赖
- 角色 `PUT` 省略 `permissions` 不再清空 RoleMenu；部门 `PUT` 省略 `pid` 保留父节点
- 用户名软删 tombstone；Prisma `P2002` → HTTP 409
- 字典版本在 Redis 不可用时降级回落
- 上传默认 MIME **去掉** `image/svg+xml`；静态响应加 `X-Content-Type-Options: nosniff`；`.svg` 强制 `Content-Disposition: attachment`
- vite proxy 注释改为指向 Nest（不再写 mock）
- README / engines 表述与 `^22.18 || ^24.12` 对齐；E2E 说明独立成节

### Security

- 响应用户对象禁止带 `password`；审计 detail 脱敏（登录失败不落明文密码）
- CORS credentials + Cookie `jwt`；业务接口 Bearer
- 登录路径更严限流；Health `@SkipThrottle`
- Upload：拒绝默认 SVG（防 inline XSS）；UUID 文件名防路径穿越
- Swagger production 默认关闭
- Redis Compose `requirepass`；安装/smoke 日志不入库

### Known gaps

对照审查遗留与架构「明确未做」，**不在 v0.1.0 交付范围**（或仅建议项）：

- Upload 仅 MIME 字符串校验，**未做 magic bytes / `file-type`**
- Multer memory limit 与 `UPLOAD_MAX_BYTES` 未完全对齐（曾记）
- Redis `auth:fail:{user|ip}` 登录失败锁定未做（与 IP 限流互补）
- 合同 §11 **浏览器 UI E2E / 静默 refresh 页面实跑**未勾完
- 对象存储（S3 / MinIO）未接
- **BullMQ 生产任务尚未引入**
- OAuth / 多租户 / 完整 Clean Architecture 未做
- 审计 sanitize 非递归；`SENSITIVE_KEY` 对裸 `token` 等可再补
- 限流 Redis 故障当前 fail-open；生产强开 Swagger 宜加鉴权
- Playwright（或同类）浏览器 UI E2E 未建

### Notes

- **尚未打 git tag，也未执行 `gh release create`。** 本文件与 `docs/qingzhan/release-notes-v0.1.md` 为草稿，等维护者确认后再发版。
- 真源仍是 `规则/vben-nestjs-backend-tech-plan.md` 与 `规则/api-contract-vben.md`。
