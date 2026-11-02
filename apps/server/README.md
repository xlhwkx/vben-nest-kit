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
