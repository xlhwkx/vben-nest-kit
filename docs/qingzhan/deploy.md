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

布尔开关只接受 `true/false/1/0`（忽略大小写和两端空白），留空按原默认处理，`tru/yes/on` 等误写拒绝启动。限流/失败锁定窗口和阈值须为 1 至 2147483647 的整数，0 不表示关闭。SMTP 端口须为 1–65535 的整数，队列 DB index 须为非负整数。

`CORS_ORIGINS` 使用逗号分隔的完整 HTTP(S) 源（协议、主机、可选端口），禁止路径、用户密码、通配符和 `null`。登录、刷新、退出只接受这些源及 `APP_PUBLIC_URL` 的源；反代/同源部署也须填入实际公开地址，不根据请求的 Host 或转发头推断信任。无 Origin 的非浏览器调用仍兼容；无 Origin 但报告 `Sec-Fetch-Site=cross-site` 的请求返回 403。代理应保留浏览器的 Origin / Fetch Metadata 头。

生产 Compose 显式传递 `THROTTLE_*` 窗口/阈值、`AUTH_FAIL_*` 和 `CAPTCHA_REQUIRED/CAPTCHA_E2E_BYPASS`；`--env-file` 用于 Compose 插值，不代表文件中每个配置都会自动进入容器。变更配置后须重建容器使其生效。验证码目前仅为一次性票据，启用它不等于接入服务端人机验证。

认证计数脚本需要 Redis ACL 允许 EVAL、GET、TTL、SET、INCR、EXPIRE；原限流/验证码还需要各自的命令权限。历史无过期计数键会在读取时补上当前窗口；损坏的计数键会使相关登录返回 503，排障时核对并修复该键及写入来源。Redis 回复丢失后的重试可能额外计数，当前协议不提供失败请求的幂等去重。

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

## 备份与迁移演练

生产发版前至少在演练库跑一遍：`docs/qingzhan/backup-migrate.md`（`pg_dump`/`pg_restore`、Prisma `migrate deploy` 纪律、Redis 可重建说明、勾选清单）。

压测烟测（本地，CI 默认不跑）：

```bash
pnpm test:load:smoke
# BASE_URL=http://127.0.0.1:5320 SMOKE_WITH_UPLOAD=1 pnpm test:load:smoke
```

## 与前端

唯一管理前端位于 `apps/admin`（`pnpm build:admin`，发布 `apps/admin/dist`），使用后端权限与真实 API，生产默认同源 `/api`。初始化、代理和回归门槛见[生产验收指南](./production-acceptance.md)。

## 上传与对象存储预算

上传只接收一个名为 `file` 的文件，拒绝普通字段及额外文件。`UPLOAD_MAX_BYTES` 控制文件字节数，默认 5 MiB；`UPLOAD_MAX_CONCURRENT` 默认每进程 4 个活动请求，覆盖解析、校验和存储，满额返回 503，无等待队列。非法请求、客户端中途断开和存储失败会释放名额；已完成解析后正在进行的存储会保留名额直到完成/失败。

此预算不是集群总配额。入口代理还应设置总请求体、请求接收和空闲超时，并按文件大小加少量 multipart 开销。例如默认 5 MiB 文件可用 Nginx `client_max_body_size 6m; client_body_timeout 60s;`。Node HTTP 服务仍保留自身请求接收超时；本地文件系统硬故障不由 S3 取消机制覆盖。

生产 Compose 现已传入上传参数，以及 S3 的 endpoint、region、bucket、凭据、path-style、公网 URL 和 `S3_UPLOAD_TIMEOUT_MS`。`STORAGE_DRIVER=s3` 时 bucket 与凭据缺失会拒绝启动；local 模式不要求 S3 凭据。S3 PUT 默认 15 秒总预算，使用 AbortSignal 取消 SDK 操作（含重试），超时返回 503。SDK 客户端随服务关闭而销毁。取消或回复丢失时远端对象可能已经写入，仍需对象存储生命周期/孤儿对象治理。

S3 URL 是公开访问契约，bucket/CDN 策略须配套；没有私有文件 ACL 或签名下载。本机协议测试不替代目标云厂商/MinIO 的实际兼容验收。SMTP 与队列审计归档仍是已标注的可选骨架。

## 数据维护（显式运行，默认预览）

构建后的 `dist/cli/maintain-data.js` 可在镜像内执行。必须指定目标和 UTC 截止时间；以下日期仅演示参数格式，生产需替换为经过保留策略评估的时间：

```bash
# 预览：不删除。容器已注入 DATABASE_URL。
docker compose -f compose.prod.yml --env-file .env.production exec -T server \
  node dist/cli/maintain-data.js --target=sessions --before=2020-01-01T00:00:00Z

# 显式执行：每批 500，最多 20 批（本轮最多删 10000 行）。
docker compose -f compose.prod.yml --env-file .env.production exec -T server \
  node dist/cli/maintain-data.js --target=sessions --before=2020-01-01T00:00:00Z \
  --apply --batch-size=500 --max-batches=20
```

本地可在 apps/server 下使用 `node --env-file=.env dist/cli/maintain-data.js ...`；已有环境变量时也可用 `pnpm maintenance:data --target=... --before=...`。没有安装自动定时任务。

`sessions` 只删除 expiresAt 严格早于截止时间的记录；截止时间不得在未来。未过期记录即使已 revoked 也保留，以维持旧令牌注销整族会话的语义。`audit` 必须显式改为 `--target=audit`，按 createdAt 删除；默认没有任何审计保留期或自动删除。先决定法规/业务保留要求、完成归档和备份恢复验证，再执行审计清理。

每批事务以 SKIP LOCKED 取固定数量候选，锁等待 1 秒、单语句 5 秒；并行维护不会互相等待已锁候选。输出包含初始候选计数、实际删除数、批次数和本轮上限；初始计数只是当时快照。中途失败时前面批次可能已提交，可重复运行。还有数据或暂被其他事务锁住时，需要后续再次执行；工具不声称已自动归档或清空全部历史数据。
