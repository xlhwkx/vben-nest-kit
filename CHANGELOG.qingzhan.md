# 青栈 Changelog

> 本文件只记录 **青栈（Qingzhan）** 相对上游 Vben Admin 的后端与联调变更。  
> 上游各包自带的 `CHANGELOG.md`（如 `apps/web-antd`、`packages/*`）**不要改写本文件、也不被本文件覆盖**。

## Unreleased

### Added
- 企业稳态③：`docs/qingzhan/backup-migrate.md`（pg_dump/restore、Prisma migrate 纪律、Redis 可重建、演练清单）；`scripts/qingzhan/load-smoke.mjs` + 根/`@qingzhan/server` script `test:load:smoke`（health+login 轻量烟测，CI 默认不跑）

- 企业稳态②：`apps/server/Dockerfile`（Node 22 多阶段、非 root）+ `compose.prod.yml`；SIGTERM 优雅退出；生产 env fail-fast（占位 JWT / E2E bypass / 无 METRICS_TOKEN）；`docs/qingzhan/deploy.md`；Redis 连接失败日志改为 fail-closed 表述
- 开源发版准备：`docs/qingzhan/open-source-checklist.md` 发布态勾选；`release-notes-v0.2.0.md`；`.github/workflows/qingzhan-release.yml`（`workflow_dispatch` + 默认 `if: false`，不改可见性、不真发 Release）
- web-antd：`VITE_CAPTCHA_REQUIRED` 时 `getCaptchaApi` + login 提交 `captchaId`/`captchaToken`（默认关行为不变）
- Captcha harness：`GET /api/auth/captcha`；`CAPTCHA_REQUIRED`（默认关，合同兼容）+ `CAPTCHA_E2E_BYPASS`（仅测试）；web-antd `VITE_CAPTCHA_E2E_BYPASS` 隐藏滑块自动过
- Mail：`MailProvider`（= tech plan `MailSender`；`console` 默认 / `smtp` dry-run）；BullMQ mail worker 脱敏日志；不连真 SMTP
- `docs/qingzhan/mock-field-parity.md`：backend-mock vs Nest 字段级对账与剩余缺口
- e2e：`GET /system/role/list` 字段锁；`POST` 无 code 自动 slug + `PUT {status}` 部分更新
- P2 timezone: `GET/POST /api/timezone/*` (getTimezone Bearer, getTimezoneOptions public, setTimezone whitelist)
- P2 optional `GET /api/demo/bigint` (Bearer; raw JSON keeps oversized id literals for json-bigint)
- P2 demo: `GET /api/table/list` (Bearer, items+total) and `GET /api/status` (public error envelope)
- e2e: `/api/dict/all|data|version` and table/status
- M4 可选骨架：`StorageProvider`（local 默认 / s3 兼容 MinIO）；`QueueModule` + BullMQ（mail / audit-archive 占位，`QUEUE_ENABLED` 默认关）
- GitHub Actions：`.github/workflows/qingzhan-server-e2e.yml`（Compose PG16+Redis7、随机 JWT、server-only e2e）
- （清单已升为发布态勾选，见上「开源发版准备」）
- 登录失败锁定：`auth:fail:user:{username}` + `auth:fail:ip:{ip}`（`AUTH_FAIL_MAX` / `AUTH_FAIL_WINDOW_SEC`，默认 5 次 / 15min）→ HTTP **429**；成功登录清零用户名计数；审计 `auth.login_locked`
- Upload **magic-bytes**（`file-type`）：真实类型须 ∈ 白名单，伪造 Content-Type → 400；multer `fileSize` 与 `UPLOAD_MAX_BYTES` 对齐

### Changed
- Captcha 拒票 `message` 改为可读文案（不再裸 `BadRequestException`）
- Mock `/api/test` 探活：Nest **不实现**；用 `GET /api/v1/health`（及 live/ready）替代，见 `docs/qingzhan/architecture.md`
- 登录 throttler Redis storage：**fail-closed**（Redis 不可用 → HTTP **503** `Rate limit unavailable`）；其它路由仍 fail-open + warn
- Known gaps：补 **SliderCaptcha** 阻碍 headless UI 登录 / 静默 refresh 自动化勾选；划掉本刀已清项

### Fixed
- list `startTime`/`endTime` date-only → **Asia/Shanghai** calendar day (was UTC day end)
- playground system/user 列表/详情：roles 展示 **name (code)**（getRoleList 映射），不再只显示 id
- playground system/user：角色多选绑定 `roles`；创建/编辑密码前端 ≥6

- server tsconfig: drop unused `baseUrl`; test `moduleResolution` -> `nodenext` (oxlint type-aware)
- system/role：PUT 支持部分更新（playground 状态开关只传 `{status}`）；POST `code` 可选自动 slug
- Local storage：`put` 拒绝 `..` / 绝对路径穿越；单测覆盖
- `STORAGE_DRIVER=s3` 时跳过本地 `useStaticAssets(/uploads)`
- 文档：`S3_PUBLIC_URL` / 桶策略决定返回 URL 是否可读
- Queue stub Worker：日志仅 id+name，不再 `JSON.stringify(job.data)`
- Upload：`MulterModule.registerAsync` 经 `ConfigService` 读 `UPLOAD_MAX_BYTES`（避免装饰器求值时 env 未加载）
- 技术方案 Redis 键名与实现对齐：`auth:fail:user:…` / `auth:fail:ip:…`
- 文档明确 `THROTTLE_STORAGE=memory` 下无登录 Redis fail-closed；`auth:fail` 在 Redis 宕时 fail-open
- e2e：Redis `eval` 失败时 login → 503（fail-closed）
- CI：`pnpm/action-setup` 去掉 `version`，改用根 `packageManager`；install 改为根 `--filter @qingzhan/server...` + 根 `allowBuilds`（去掉 `dangerouslyAllowAllBuilds`；`--ignore-workspace` 不会读 allowBuilds）
- CI：filter install 设 `IGNORE_STUB=1`，根 `postinstall` 经 `scripts/postinstall-stub.mjs` 跳过全仓 stub（避免未装依赖的 internal/* 失败）；仍走根 `allowBuilds`，不用 `dangerouslyAllowAllBuilds`
- CI：GHA Node **24**（Jest 30 + Nest 12 ESM 需 ≥24.9）

### Security
- 凭证爆破：失败计数锁定与 IP QPS 限流互补
- 上传内容嗅探，防 MZ/可执行体伪装 PNG 等


## [0.1.0] — 2026-11-02

HEAD：以 `v0.1.0` tag 所指 commit 为准。  
包版本：`apps/server` / `@qingzhan/server` = `0.1.0`。根 monorepo 仍为上游 `5.7.0`，未 bump。

### Added

- NestJS 12 + Express 后端骨架 `apps/server`（`@qingzhan/server`），Prisma 7 + PostgreSQL、Redis、Docker Compose
- Auth P0：`login` / `refresh` / `logout` / `codes`；JWT Bearer + HttpOnly Cookie `jwt`；Argon2id；Prisma seed（**vben / admin / jack**，密码 `123456`）
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

- web-antd 登录页 **SliderCaptcha** 阻碍 headless / 自动化 UI 登录与静默 refresh 勾选（勿为过测默认关掉验证码）
- 合同 §11 **浏览器 UI E2E / 静默 refresh 页面实跑**未勾完
- 对象存储（S3 / MinIO）未接
- **BullMQ 生产任务尚未引入**
- OAuth / 多租户 / 完整 Clean Architecture 未做
- 审计 sanitize 非递归；`SENSITIVE_KEY` 对裸 `token` 等可再补
- 登录限流 Redis 已 fail-closed；**非登录**路由仍 fail-open；生产强开 Swagger 宜加鉴权
- Playwright（或同类）浏览器 UI E2E 未建

### Notes

- 已打 annotated tag **`v0.1.0`**；仓库当前为 **private**，**暂不创建 GitHub Release**（需要对外链接时再补）。
- 真源仍是 `规则/vben-nestjs-backend-tech-plan.md` 与 `规则/api-contract-vben.md`。
