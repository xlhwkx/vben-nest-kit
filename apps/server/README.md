# @qingzhan/server

青栈 NestJS 12 后端。契约见仓库根目录 `规则/`。

```bash
pnpm install          # 建议在 monorepo 根执行
pnpm start:dev        # 默认端口 5320
pnpm build
```

健康检查：

- `GET /api/health`、`GET /api/v1/health` — 基础探活（信封）
- `GET /api/health/live`、`GET /api/v1/health/live` — 进程存活（不查 DB/Redis）
- `GET /api/health/ready`、`GET /api/v1/health/ready` — Postgres + Redis；失败 503

Swagger UI（非 production 默认开；生产设 `SWAGGER_ENABLED=true` 强制开）：`http://localhost:5320/api/docs`

## 与 web-antd 联调

前端开发默认走本服务（见仓库根 `README.md`「前端联调」）：

1. 本服务监听 `5320`（`pnpm start:dev`）
2. 根目录 `pnpm dev:antd`（`VITE_NITRO_MOCK=false`，proxy → `http://localhost:5320/api`）
3. Demo：`vben` / `admin` / `jack`，密码 `123456`

## 限流

- 全局：每 IP `THROTTLE_LIMIT`（默认 120）/ `THROTTLE_TTL_MS`（默认 60s）
- 登录 `POST /api/auth/login`（及 `/api/v1`）：`THROTTLE_LOGIN_LIMIT`（默认 10）/ `THROTTLE_LOGIN_TTL_MS`（默认 60s），超限 **429** 信封
- Health（live/ready）`@SkipThrottle`；Swagger `/api/docs` 在 Nest 管道外
- 存储默认 **Redis**（`THROTTLE_STORAGE=redis`）；可改 `memory`（单机急救，生产建议 Redis）

