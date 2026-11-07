# 青栈：备份 / 迁移演练

> 企业稳态第 3 刀。目标：值班同学能按清单做一次 **可回滚** 的演练，而不是只在文档里写「记得备份」。  
> 关联：[`deploy.md`](./deploy.md)（容器部署）、[`observability.md`](./observability.md)（探活/指标）。

**禁止**：在生产库执行 `prisma migrate reset` / `db push --force-reset` / 无备份的 `DROP SCHEMA`；本仓库 CI **不**自动跑破坏性迁移。

2026-11-07 已在隔离 PostgreSQL 16 做过一次自定义格式备份/恢复：12 张表行集合摘要一致，字典版本触发器恢复后可递增/回滚。范围与限制见[第四轮记录](./production-hardening-phase4-2026-11-07.md)；这不是生产容量或文件存储的恢复演练。新版本备份需包含 `dictionary_revision` 表及字典表的触发器和函数，不能仅复制业务表数据。

## 服务名与默认凭据（Compose）

| 场景 | Compose 文件 | Postgres 服务 | Redis 服务 | 备注 |
| --- | --- | --- | --- | --- |
| 开发 | `docker-compose.yml` | `postgres`（容器名 `qingzhan-postgres`） | `redis`（`qingzhan-redis`） | 宿主口默认 `POSTGRES_PORT=55433` / `REDIS_PORT=56379` |
| 生产示例 | `compose.prod.yml` | `postgres` | `redis` | DB/Redis **不**映射宿主口；经 `docker compose exec` 进容器 |

默认库名/用户（可被 env 覆盖）：`qingzhan` / `qingzhan`。生产务必改密码。

---

## 1. Postgres：`pg_dump` / `pg_restore`

### 开发（宿主有客户端，或进容器）

```bash
# 仓库根；按 .env 端口
export PGHOST=127.0.0.1 PGPORT=${POSTGRES_PORT:-55433}
export PGUSER=${POSTGRES_USER:-qingzhan} PGPASSWORD=${POSTGRES_PASSWORD:-qingzhan}
export PGDATABASE=${POSTGRES_DB:-qingzhan}

mkdir -p backups
# 自定义格式（推荐，可并行 restore）
pg_dump -Fc -f "backups/qingzhan-$(date +%Y%m%d-%H%M%S).dump"

# 仅结构 / 仅数据（可选）
# pg_dump -Fc --schema-only -f backups/qingzhan-schema.dump
# pg_dump -Fc --data-only   -f backups/qingzhan-data.dump
```

无宿主客户端时，用 Compose：

```bash
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-qingzhan}" -Fc "${POSTGRES_DB:-qingzhan}" \
  > "backups/qingzhan-$(date +%Y%m%d-%H%M%S).dump"
```

### 生产示例（`compose.prod.yml`）

```bash
docker compose -f compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
  > "backups/qingzhan-prod-$(date +%Y%m%d-%H%M%S).dump"
```

### 恢复（演练环境，先确认目标库可丢）

```bash
# 自定义格式 → 空库或已建库
pg_restore -d "$PGDATABASE" --clean --if-exists --no-owner --no-acl \
  "backups/qingzhan-YYYYMMDD-HHMMSS.dump"
# 或容器内：
# docker compose exec -T postgres pg_restore -U qingzhan -d qingzhan --clean --if-exists < backups/….dump
```

恢复后：

1. `GET /api/health/ready` 应 200  
2. 用 seed 账号或演练账号 `POST /api/auth/login` 一次  
3. 抽查 `system` 关键表行数（用户/角色/菜单）与备份前快照一致  

---

## 2. Prisma 迁移：`deploy` 与回滚注意

| 命令 | 用途 | 生产？ |
| --- | --- | --- |
| `pnpm --dir apps/server exec prisma migrate deploy` | 只应用未应用的迁移（正向） | ✅ 推荐 |
| `prisma migrate dev` | 开发生成迁移 | ❌ 生产勿用 |
| `prisma migrate reset` | **删库**重建 | ❌ 生产严禁 |
| `prisma db push` | 无迁移历史对齐 | ❌ 生产勿作常规手段 |

入口：`compose.prod.yml` 默认 `RUN_MIGRATE_ON_START=true`（见 `apps/server/docker-entrypoint.sh`）。若用 K8s Job / 独立 init，设 `RUN_MIGRATE_ON_START=false`，由 Job 先 `migrate deploy`。

### 回滚策略（无破坏性强推）

Prisma Migrate **没有**一键「生产 down」安全通道。约定：

1. **发迁移前**：先 `pg_dump -Fc`（上一节），保留至少一份可 restore 的点  
2. **迁移失败 / 业务回退**：优先 **restore 到 dump**，再修迁移 SQL 后重新 `deploy`  
3. **不要** `migrate resolve --rolled-back` 后强推改历史（除非明确知道 `_prisma_migrations` 状态且有备份）  
4. 破坏性 DDL（`DROP COLUMN` / 改类型）须：双写或兼容窗口 → 新版本读新列 → 再删旧列；禁止「一条迁移直接砍生产列」无备份

本地验证迁移：

```bash
docker compose up -d
cd apps/server
pnpm exec prisma migrate deploy
# Development/test only: set ALLOW_DEMO_SEED=true in apps/server/.env first
pnpm exec prisma db seed   # 仅开发/演练库
```

---

## 3. Redis：可重建 vs 需持久

| 数据 | 键/用途（示意） | 丢了会怎样 | 策略 |
| --- | --- | --- | --- |
| 登录失败计数 | `auth:fail:user:*` / `auth:fail:ip:*` | 锁定窗口重置 | **可重建**，无需备份 |
| 登录限流 | throttler Redis keys | 短时窗口重置 | **可重建** |
| Captcha 一次性票 | captcha 相关 TTL 键 | 未用票失效，用户重拉 | **可重建** |
| Refresh 会话吊销等 | 会话/黑名单类（若启用） | 用户需重新登录 | 可接受；多实例依赖 Redis 存活而非 dump |
| 字典版本缓存等 | 短 TTL 缓存 | 回源 DB | **可重建** |
| BullMQ 队列（可选） | 邮件/审计归档占位 | 未投递任务丢失 | 生产开队列前再定持久与 DLQ；默认 `QUEUE_ENABLED` 关 |

Compose 已挂 volume（开发 `qingzhan_redis_data` / 生产 `qingzhan_prod_redis`）只为 **重启不丢内存快照**；**业务上不把 Redis 当系统真源**。演练时：

- 可 `FLUSHDB` 演练库验证服务仍能 login（锁定/限流从零开始）  
- **不要**对生产 `FLUSHALL`  
- RDB/AOF 运维备份可选，但恢复优先级低于 PG dump  

---

## 4. 上传文件（顺带）

`STORAGE_DRIVER=local` 时文件在 `UPLOAD_DIR`（生产 compose volume `qingzhan_prod_uploads`）。PG dump **不含**文件本体；完整演练需一并 rsync/卷快照。`s3` 驱动则跟桶生命周期，不在本页展开。

---

## 5. 演练检查清单（可勾选）

在**非生产**或明确允许的演练库执行：

- [ ] 记录当前 HEAD / 镜像 tag / 迁移名（`_prisma_migrations`）
- [ ] `pg_dump -Fc` 成功，文件大小 > 0，路径进备份目录
- [ ] （可选）故意停 Redis 数秒：登录应 **503 fail-closed**（`THROTTLE_STORAGE=redis`）；恢复后 login 正常
- [ ] 应用一条**无害**迁移或空跑 `migrate deploy`（Already in sync）
- [ ] 从 dump `pg_restore --clean --if-exists` 到演练库
- [ ] `curl` `/api/health/live` + `/api/health/ready` → 200
- [ ] `POST /api/auth/login`（seed：`vben` / `123456`）→ 200 信封
- [ ] （可选）跑 `pnpm test:load:smoke`（见下节链接）
- [ ] 记录耗时、负责人、异常与处理 → 贴到值班笔记

---

## 6. 压测烟测（轻量）

仓库提供 **烟测级** 负载脚本（非压测平台）：对 `health` + `login`（可选 upload）打少量并发。

```bash
# 仓库根；先保证 server 在 APP_PORT（默认 5320）且 DB/Redis 已起
pnpm test:load:smoke
# 等价：
# node scripts/qingzhan/load-smoke.mjs
```

说明见脚本头注释与 [`../..`](../../scripts/qingzhan/load-smoke.mjs)。**CI 默认不跑**重压测；勿把本脚本拷进 `qingzhan-server-e2e.yml` 除非单独 `workflow_dispatch` 且限时。

---

## 修订

| 日期 | 说明 |
| --- | --- |
| 2026-11-02 | 企业稳态③初版：dump/restore、migrate 纪律、Redis 可重建说明、演练清单 |
