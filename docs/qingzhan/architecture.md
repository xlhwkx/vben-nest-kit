# 青栈架构概览

> English: [architecture.en.md](./architecture.en.md)

## 定位

青栈用 Nest 后端替换 Vben 官方 `apps/backend-mock`（Nitro mock），让 `apps/web-antd` 以 `accessMode: 'backend'` 联真实 API。

交付主体：monorepo 内 **`apps/server`**（包名 `@qingzhan/server`）。前端与共享包仍来自上游 Vben；真源约定在 `规则/`，本目录只做可读摘要，**不替代合同**。

## 技术栈（当前实现）

| 层 | 选型 |
|----|------|
| HTTP | NestJS 12 + Express（`@nestjs/platform-express`） |
| ORM / DB | Prisma 7 + PostgreSQL 16 |
| 缓存 / 限流存储 | Redis 7（`ioredis`） |
| 认证 | JWT access（Bearer）+ refresh（HttpOnly Cookie 名 `jwt`） |
| 密码 | Argon2id |
| 授权 | RBAC；前端 `accessMode: 'backend'`，权限码来自 `GET /auth/codes` |
| 文档 | Swagger UI `/api/docs`（非 production 默认开） |
| 限流 | `@nestjs/throttler`（默认 Redis storage） |

## API 约定（摘要）

- **双前缀**：业务路由同时挂 `/api`（兼容 mock）与 `/api/v1`。
- **信封**：`{ code, data, message, error }`；`code === 0` 成功。
- **唯一例外**：`POST /auth/refresh` 返回**纯 accessToken 字符串**（非信封），与前端 `baseRequestClient` 对齐。
- **鉴权**：业务接口 Bearer access；refresh/logout 依赖 Cookie `jwt` + CORS credentials。
- **禁止**：任何成功响应用户对象里带 `password`。

细节与字段表见 `规则/api-contract-vben.md`。

## 模块地图（`apps/server/src`）

| 模块 | 职责 |
|------|------|
| `auth` | login / refresh / logout / codes |
| `user` | `GET /user/info` 等 |
| `menu` | `GET /menu/all` 动态菜单 |
| `system` | 用户/角色/菜单/部门/字典管理端 CRUD |
| `upload` | 本地上传；静态 `/uploads`；默认禁用 SVG |
| `audit` | `AuditLog` 落库 + `GET /system/audit/list` |
| `health` | `/health`、`/health/live`、`/health/ready`（ready 查 PG+Redis） |
| `common` / `prisma` / `redis` | 横切：配置、守卫、信封、Prisma、Redis |

## 本地端口（以 `.env.example` / Compose 为准）

| 服务 | 习惯值 |
|------|--------|
| Nest `APP_PORT` | **5320** |
| Postgres 宿主端口 | **55433**（容器内 5432；避开本机 5432） |
| Redis 宿主端口 | **56379**（容器内 6379；Compose 默认 `requirepass`） |
| web-antd 开发 | **5666**（vite）；proxy `/api` → `http://localhost:5320/api` |

根目录：`docker compose up -d` 起 PG + Redis。

## 横切能力（已落地要点）

- **Swagger**：`http://localhost:5320/api/docs`；production 默认关，可用 `SWAGGER_ENABLED` 强制开关。
- **限流**：全局默认约 120 次 / 60s；`POST /auth/login` 更严（默认 10 / 60s）→ HTTP 429 信封；Health 跳过。
- **审计**：login 成功/失败、logout、敏感写、upload 等异步 `record`；列表需 `System:Audit:List`；响应头 `x-request-id`。
- **上传**：本地磁盘 + UUID 文件名；MIME 白名单；静态 `X-Content-Type-Options: nosniff`。

## 明确未做（勿当成已交付）

- 对象存储（S3 / MinIO）切换
- BullMQ / 异步任务队列骨架之外的生产任务
- Playwright（或同类）浏览器 UI E2E；合同 §11 页面实跑仍记缺口
- Redis `auth:fail:{user|ip}` 登录失败锁定（与 IP 限流互补，尚未做）
- OAuth / 多租户 / 完整 Clean Architecture

## 相关链接

- 贡献： [contributing.md](./contributing.md)
- 技术方案： `规则/vben-nestjs-backend-tech-plan.md`
- API 合同： `规则/api-contract-vben.md`
