# 青栈（vben-nest-kit）

> **青栈** = 官方 [Vue Vben Admin](https://github.com/vbenjs/vue-vben-admin) 前端 monorepo + 自研 NestJS 后端（`apps/server`），用真实后端替换 `backend-mock`。

许可证：**MIT**（与 Vben / Nest 生态一致）。

## 目录结构

```
vben-nest-kit/
├── 规则/                      # 真源：技术方案 + API 合同（优先于口头约定）
├── docs/qingzhan/               # 青栈架构/贡献（中英；VitePress 仍在 docs/src）
├── apps/
│   ├── server/                # 青栈 Nest 12 后端（本仓库交付主体）
│   ├── web-antd/              # Vben Ant Design Vue 前端
│   ├── backend-mock/          # 官方 mock（仅对照，非交付）
│   └── web-*                  # 其它 UI 变体
├── packages/                  # Vben 共享包
├── docker-compose.yml         # Postgres 16 + Redis 7（Redis 默认 requirepass）
├── .env.example               # 环境变量模板（勿提交 .env）
├── README.md                  # 本文件（青栈说明）
└── README.vben.md / README.zh-CN.md  # 上游 Vben 说明
```

## 真源文档

- `规则/vben-nestjs-backend-tech-plan.md` — 技术选型与里程碑
- `规则/api-contract-vben.md` — 路径 / 方法 / 信封 / Cookie / Bearer

### 青栈可读文档（摘要，不替代合同）

- 架构：[docs/qingzhan/architecture.md](docs/qingzhan/architecture.md) · English: [docs/qingzhan/architecture.en.md](docs/qingzhan/architecture.en.md)
- 贡献：[docs/qingzhan/contributing.md](docs/qingzhan/contributing.md) · English: [docs/qingzhan/contributing.en.md](docs/qingzhan/contributing.en.md)
- 索引：`docs/qingzhan/README.md`

## 后端（apps/server）快速开始

```bash
# 1) 基础设施
cp .env.example .env
docker compose up -d

# 2) 安装依赖
# 主路径：仓库根（pnpm workspace 会纳入 @qingzhan/server）
pnpm install

# 若根目录 pnpm install 因 Vben 上游 postinstall / leftover 失败，用 fallback：
cd apps/server
pnpm install --ignore-workspace
cd ../..

# 稳定后优先：
# pnpm --filter @qingzhan/server ...

# 3) 仅跑 Nest
pnpm --filter @qingzhan/server start:dev
# 若未走 workspace filter，可：
# cd apps/server && pnpm start:dev
# 默认 http://localhost:5320/api/health、/api/v1/health/live|/ready；Swagger /api/docs
```

**安装说明：** 根 `pnpm install` 会跑 Vben monorepo 的 postinstall；若因网络/leftover 失败，**不要阻塞后端**——改用 `cd apps/server && pnpm install --ignore-workspace`。`apps/server/pnpm-lock.yaml` 已加入 `.gitignore`（workspace 场景下以根 lock 为准）。目标是把 `@qingzhan/server` 稳定进根 workspace（`pnpm --filter @qingzhan/server`），当前允许上述 fallback。

当前切片（Auth P0）：

- Prisma 7 + PostgreSQL（User/Role/Permission/RefreshToken）
- Argon2id + JWT access/refresh（refresh 哈希入库，Cookie 名 `jwt`）
- Redis 权限码短缓存（`perm:codes:{userId}`）
- CORS credentials + Cookie sameSite/secure 可配


## Auth P0（已落地）

合同路径（均挂 `/api` 与 `/api/v1`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/login` | 信封；`data.accessToken`；Set-Cookie `jwt`=refresh；**不返回 password** |
| POST | `/auth/refresh` | **纯 accessToken 字符串**（非信封）；读 Cookie `jwt`；旋转 refresh |
| POST | `/auth/logout` | 清 Cookie + 吊销 refresh |
| GET | `/auth/codes` | Bearer；权限码数组 |
| GET | `/user/info` | Bearer；用户摘要 |
| GET | `/menu/all` | Bearer；最小动态菜单（Dashboard + 角色 demo） |

Seed 账号（Argon2id）：`vben` / `admin` / `jack`，密码均为 `123456`。

```bash
cp .env.example .env
docker compose up -d
cd apps/server
pnpm install --ignore-workspace
pnpm exec prisma generate
pnpm exec prisma migrate deploy   # 或 migrate dev
pnpm exec prisma db seed
pnpm run build && pnpm run start:prod
# 默认 http://localhost:5320
```

> 本机若 5432/6379 已被占用，`.env.example` 默认宿主端口为 **55433**（PG）/ **56379**（Redis）。


### Audit（Nest-only）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/system/audit/list` | Bearer + `System:Audit:List`；分页 `items`+`total`；双前缀 `/api` 与 `/api/v1` |

Auth 登录成功/失败/登出与 System 写操作会异步落 `audit_logs`；响应带头 `x-request-id`。

### E2E

```bash
cd apps/server && pnpm test:e2e
```

需 Compose + `.env` + seed；详见 `apps/server/README.md`。Node engines：`^22.18 || ^24.12`（需支持 `--experimental-vm-modules`）。

### 限流

`@nestjs/throttler`：全局默认 120 次/60s；`POST /auth/login` 更严（默认 10 次/60s）→ 429。存储默认 Redis（`THROTTLE_STORAGE`，见 `apps/server/.env.example`）。Health 跳过限流。

## 前端联调（web-antd ↔ Nest）

官方联调路径只改 **web-antd**（其它 `web-*` 同理：关 Nitro mock + `accessMode: 'backend'` + proxy 指向 Nest）。

### 配置（已落库）

| 项 | 值 |
|----|-----|
| `apps/web-antd/.env.development` → `VITE_NITRO_MOCK` | `false`（关 Nitro / backend-mock） |
| 同上 → `VITE_GLOB_API_URL` | `/api`（经 vite proxy） |
| `apps/web-antd/vite.config.ts` proxy | `/api` → `http://localhost:5320/api` |
| `apps/web-antd/src/preferences.ts` | `app.accessMode: 'backend'`、`app.enableRefreshToken: true` |

> **改 preferences 后务必清浏览器站点数据 / localStorage**（Vben 会持久化偏好，否则仍可能是 `frontend`）。

### 启动

```bash
# 终端 1：基础设施 + Nest（若尚未在跑）
cp .env.example .env          # 首次
docker compose up -d
cd apps/server && pnpm start:dev   # 或根目录 pnpm --filter @qingzhan/server start:dev
# Nest: http://localhost:5320

# 终端 2：前端
pnpm install                  # 首次 / 依赖变更后
pnpm dev:antd                 # → http://localhost:5666
```

Demo 账号（密码均为 `123456`）：`vben`（super）/ `admin` / `jack`（user）。

Swagger：`http://localhost:5320/api/docs`。合同验收清单：`规则/api-contract-vben.md` §11。

上游 Vben 文档见 `README.vben.md` / `README.zh-CN.md`。

