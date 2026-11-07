# 青栈架构（摘要）

> 本页是实现摘要，**不替代**真源合同：`规则/vben-nestjs-backend-tech-plan.md`、`规则/api-contract-vben.md`。

## 栈

| 层 | 选型 |
| --- | --- |
| 前端 | 完整管理页面 playground；web-antd 为 UI 接入示例。均为 `accessMode: backend`、`VITE_NITRO_MOCK=false` |
| 后端 | NestJS 12 + Express（`apps/server` / `@qingzhan/server`） |
| ORM / DB | Prisma 7 + PostgreSQL |
| 缓存 / 限流存储 | Redis 7（`ioredis`） |
| 鉴权 | JWT Bearer + HttpOnly Cookie `jwt`（refresh）；Argon2id |
| 限流 | `@nestjs/throttler`（默认 Redis storage） |
| 文件存储 | 默认 Local；可选 S3 兼容（`STORAGE_DRIVER=s3`）。返回 URL 依赖桶策略或 `S3_PUBLIC_URL`；`s3` 时不挂本地 `/uploads` static |
| 队列 | BullMQ 可选骨架（默认 `QUEUE_ENABLED=false`） |
| 文档 | Swagger `/api/docs` |

> **S3 URL**：`put` 返回的 `data.url` 由 `S3_PUBLIC_URL`（优先）或 `endpoint/bucket` / AWS 默认域名拼接；对象是否可被浏览器匿名读取取决于桶策略、CDN 或预签名，不单由 URL 字符串决定。`STORAGE_DRIVER=s3` 时进程不挂载本地 `UPLOAD_DIR` 静态目录。

## 双前缀与信封

- 兼容别名：`/api/*`；版本：`/api/v1/*`
- 成功/错误统一信封 `{ code, data, error, message }`（`code: 0` 成功）
- **例外**：`POST /auth/refresh` 响应体为**纯 accessToken 字符串**（无信封）

## 模块地图（后端）

Auth · User · Menu · System（用户/角色/菜单/部门/字典）· Upload · Health · Audit

## 本地端口

- Nest：`5320`
- playground dev：`5555`（完整管理入口，vite proxy → Nest）；web-antd 示例：`5666`
- Compose Postgres / Redis：见 `apps/server/.env.example`（宿主映射避开本机常用口）
- 生产容器部署：`docs/qingzhan/deploy.md`（`compose.prod.yml` + `apps/server/Dockerfile`）

## 横切（已交付要点）

- **Swagger**：`http://localhost:5320/api/docs`；production 默认关，可用 `SWAGGER_ENABLED` 强制开关。
- **限流**：全局默认约 120 次 / 60s；`POST /auth/login` 更严（默认 10 / 60s）→ HTTP 429 信封；Health 跳过。默认 `THROTTLE_STORAGE=redis`：登录 throttler 在 Redis 故障时 **fail-closed（503）**；其它路由 fail-open + warn。设 `THROTTLE_STORAGE=memory` 时改用进程内桶（单机急救），**无** Redis fail-closed；同时 `auth:fail` 仍读写 Redis——Redis 不可用时锁定检查 **fail-closed（HTTP 503 Login lock unavailable）**。生产请保持 redis。
- **登录失败锁定**：`auth:fail:user:{username}` + `auth:fail:ip:{ip}`（默认 5 次 / 15min → HTTP 429）；成功登录清零用户名计数；与 IP QPS 限流互补。
- **可观测**：结构化日志 + `x-request-id`；`GET /api/health/metrics`（Prometheus，可 `METRICS_TOKEN`）；OTel 默认关（见 [observability.md](./observability.md)）。
- **审计**：login 成功/失败/锁定、logout、敏感写、upload 等异步 `record`；列表需 `System:Audit:List`；响应头 `x-request-id`。
- **上传**：`StorageProvider`（local 默认 / s3 可选）+ UUID；MIME 白名单 + **magic-bytes**（`file-type`）；默认无 SVG；`nosniff`；multer 上限对齐 `UPLOAD_MAX_BYTES`。
- **队列**：`QueueModule` + BullMQ（mail / audit-archive）；默认关闭；`MAIL_DRIVER=console|smtp`（默认 console，smtp 仅 dry-run）。实现名 `MailProvider`，技术方案 §26 称 `MailSender`（类型别名已对齐）。
- **验证码票据**：web-antd 接入示例保留 **SliderCaptcha**；服务端默认不强制。`CAPTCHA_REQUIRED=true` 要求提交 `GET /api/auth/captcha` 返回的票据，以 Redis GETDEL 保证只消费一次；存储不可用返回 503。该公开票据本身不验证人类动作，不能作为服务端反机器人能力。前端 `VITE_CAPTCHA_REQUIRED=true` 会先拉票再登录；服务端 `CAPTCHA_E2E_BYPASS` 仅测试可用，生产禁止；青栈 Vite 配置在所有 mode 拒绝前端旁路。

## API 覆盖备注（相对 mock）

- **P2 已齐**：`/api/table/list`、`/api/status`、`/api/timezone/*`、可选 `/api/demo/bigint`（均双前缀 `/api` + `/api/v1`）。
- **`/api/test`**：mock 探活（GET/POST 返回纯文本）。Nest **不提供**该路径；联调/探活请用 `GET /api/v1/health`、`/health/live`、`/health/ready`（合同 §8 允许用 health 替代）。

## 明确未做（勿当成已交付）

- 对象存储生产运维（MinIO Compose 一键 / 生命周期策略等仍可选）
- BullMQ 独立 worker 进程与生产 SMTP 投递（已有 console/smtp dry-run 骨架，默认不连外网）
- 已新增双 UI 的 Playwright 认证/安全联调 CI；真实运行和正式 dist 的 HTTPS 站点验收仍待完成，见[验收指南](./production-acceptance.md)
- OAuth / 多租户 / 完整 Clean Architecture

## 人工冒烟（§11）

1. 根目录 `pnpm install --frozen-lockfile`、迁移并显式开发 seed 后，`pnpm dev:admin` + Nest `:5320`
2. 浏览器完成登录页滑块，以 `vben` / `123456` 登录；青栈前端拒绝开启 E2E 验证码旁路
3. 确认菜单加载；可选：缩短 `JWT_ACCESS_TTL` 后观察静默 refresh

## 相关链接

- 可观测： [observability.md](./observability.md)
- 贡献： [contributing.md](./contributing.md)
- 技术方案： `规则/vben-nestjs-backend-tech-plan.md`
- API 合同： `规则/api-contract-vben.md`
