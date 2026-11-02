# 青栈生产部署（短运维）

> 企业稳态第 2 刀：可容器化部署的 Nest server。开发联调仍用根目录 `docker-compose.yml`（只起 PG+Redis）。

## 形态

| 文件 | 用途 |
| --- | --- |
| `docker-compose.yml` | **开发**：Postgres 16 + Redis 7，端口可改；server 在宿主跑 |
| `compose.prod.yml` | **生产示例**：server 镜像 + PG + Redis；DB/Redis 不暴露宿主口 |
| `apps/server/Dockerfile` | Node 22 多阶段构建，非 root（`node`），健康检查打 `/api/health/live` |

## 一键（示例）

```bash
# 1. 复制并改密钥（JWT ≥32、METRICS_TOKEN、DB/Redis 密码）
cp .env.example .env.production
# 编辑 .env.production …

# 2. 构建并启动
docker compose -f compose.prod.yml --env-file .env.production up -d --build

# 3. 探活
curl -sS http://127.0.0.1:5320/api/health/live
curl -sS http://127.0.0.1:5320/api/health/ready
```

仅构建镜像：

```bash
docker build -f apps/server/Dockerfile -t qingzhan-server:local .
```

## 配置校验（启动 fail-fast）

`loadEnv`（Zod）在进程起来前校验；缺 `DATABASE_URL` / `REDIS_URL` / `JWT_*`（≥32）会抛清晰错误并退出。

**`NODE_ENV=production` 额外硬门槛：**

- 禁止 `CAPTCHA_E2E_BYPASS=true`
- JWT 不得再使用文档里的 `change-me-…` 占位串
- `METRICS_ENABLED` 未关时 **必须** 设置 `METRICS_TOKEN`（否则裸奔指标口）
- 建议 `COOKIE_SECURE=true`（未开会 warn）

详见 `apps/server/.env.example` 与 `docs/qingzhan/observability.md`。

## 优雅退出

进程收到 **SIGTERM/SIGINT** 后：`enableShutdownHooks` → 停收新连接并关闭 HTTP，再 `OnModuleDestroy` 断开 Prisma / Redis（及可选 Queue）。Compose 已设 `stop_grace_period: 30s`。

## 迁移

默认 `RUN_MIGRATE_ON_START=true`：入口脚本先 `prisma migrate deploy` 再 `node dist/main.js`。生产若改用独立 Job/InitContainer，设 `RUN_MIGRATE_ON_START=false`。

## 指标

生产：**配 `METRICS_TOKEN` 或设 `METRICS_ENABLED=false`**。抓取仅内网 / sidecar。见 observability 文档。

## 与前端

web-antd：`accessMode: backend`，代理/`VITE_GLOB_API_URL` 指到本服务的 `/api`。本刀不改仓库可见性、不打 GitHub Release。
