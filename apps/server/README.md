# @qingzhan/server

青栈 NestJS 12 后端。契约见仓库根目录 `规则/`。

```bash
pnpm install --frozen-lockfile      # 在 monorepo 根执行
pnpm --filter @qingzhan/server start:dev  # 默认端口 5320
pnpm --filter @qingzhan/server build
```

健康检查：

- `GET /api/health`、`GET /api/v1/health` — 基础探活（信封）
- `GET /api/health/live`、`GET /api/v1/health/live` — 进程存活（不查 DB/Redis）
- `GET /api/health/ready`、`GET /api/v1/health/ready` — Postgres + Redis；失败 503

Swagger UI（非 production 默认开；生产设 `SWAGGER_ENABLED=true` 强制开）：`http://localhost:5320/api/docs`

## 与管理前端联调

唯一管理前端位于 `apps/admin`（见仓库根 `README.md`）：

1. 本服务监听 `5320`（`pnpm start:dev`）
2. 根目录 `pnpm dev:admin` → localhost:5555（`VITE_NITRO_MOCK=false`，proxy → `http://localhost:5320/api`）
3. Demo：`vben` / `admin` / `jack`，密码 `123456`

登录、刷新、退出会检查浏览器 `Origin`：只允许 `CORS_ORIGINS` 中的源，以及 `APP_PUBLIC_URL` 的源。开发代理也须保留并配置实际前端源；白名单使用完整 HTTP(S) 源，不含路径或通配符。拒绝返回 403，不写 Cookie、不修改认证会话。不带 Origin 的 CLI/服务端客户端保持兼容；缺少 Origin 且 `Sec-Fetch-Site=cross-site` 的请求拒绝。来源检查不能替代身份认证，也不能防御受信任前端上的 XSS。

## 限流

- 全局：每 IP `THROTTLE_LIMIT`（默认 120）/ `THROTTLE_TTL_MS`（默认 60s）
- 登录 `POST /api/auth/login`（及 `/api/v1`）：`THROTTLE_LOGIN_LIMIT`（默认 10）/ `THROTTLE_LOGIN_TTL_MS`（默认 60s），超限 **429** 信封
- Health 的 live/metrics 跳过限流；ready 单独限流 30/IP/分钟，PG/Redis 探测单飞并短缓存 1 秒；metrics 见 docs/qingzhan/observability.md；Swagger `/api/docs` 在 Nest 管道外
- 存储默认 **Redis**（`THROTTLE_STORAGE=redis`）；可改 `memory`（单机急救，生产建议 Redis）
- `memory` 模式：登录限流不走 Redis，**无** fail-closed；`auth:fail:*` 仍读写 Redis，Redis 不可用时锁定检查 fail-closed（503）
- `redis` 模式：登录 throttler Redis 故障 → HTTP **503** `Rate limit unavailable`
- 登录失败计数和 TTL 用 Redis 脚本原子处理，正常读取/递增不延长已有窗口；读取会给历史无过期键补上窗口。非法计数或存储故障返回 503，不按零计数放行。
- 配置布尔值只接受 `true/false/1/0`（忽略大小写和两端空白）；窗口/阈值须为正整数，误写会阻止启动。生产 Compose 已映射登录限流、失败锁定和验证码开关。

## E2E

上传只接受一个 `file`，拒绝额外表单字段。默认每进程最多同时处理 4 个上传，满额 503；S3 PUT 有取消预算。生产 Compose 已映射 S3 与上传配置，见 `docs/qingzhan/deploy.md`。后台尽力审计的积压与并发预算、丢弃指标见 `docs/qingzhan/observability.md`。

数据维护入口：构建后运行 `pnpm maintenance:data --target=sessions --before=<UTC ISO时间>`，默认仅预览；显式 `--apply` 执行有限批次。审计清理必须选择 `--target=audit`，没有默认保留期或自动任务，详见部署文档。

依赖本机 Compose（Postgres + Redis）与 `apps/server/.env`（含 seed 账号）。不要提交密钥。

Node：仓库 engines 为 `^22.18 || ^24.12`；本套件需支持 `--experimental-vm-modules` 的 Node（脚本已带该 flag）。

```bash
# 仓库根
docker compose up -d
cd apps/server
# 首次：migrate + seed
pnpm exec prisma migrate deploy
# Development/test only: set ALLOW_DEMO_SEED=true in apps/server/.env first
pnpm exec prisma db seed
pnpm test:e2e
# 或根目录：pnpm --dir apps/server test:e2e
```

覆盖：health live/ready、login（含错密）、Bearer user/info·codes·menu/all、Cookie refresh（纯字符串）、logout 清 cookie、无 token 401；可选 jack audit 403、upload 缺 file 400。套件内将 THROTTLE_STORAGE=memory 并抬高 limit，避免误伤。

## 浏览器认证回归

仓库根执行 `pnpm test:auth:browser`，使用已安装的 Playwright Chromium，调用真实 Vite 前端认证模块和真实 Nest API。执行前启动一个隔离、完成迁移和测试账号初始化的 API，以及 apps/admin 的 Vite 服务；前端 `VITE_NITRO_MOCK=false`，`VITE_GLOB_API_URL` 必须指向该 API。

命令要求显式设置四个环境变量，没有默认目标或账号：

| 变量 | 示例/用途 |
| --- | --- |
| AUTH_BROWSER_FRONTEND_URL | `http://127.0.0.1:5555`，Vite 前端地址 |
| AUTH_BROWSER_API_URL | `http://127.0.0.1:5320/api`，须与前端不同 origin，且在服务端 CORS 中允许前端 origin |
| AUTH_BROWSER_USERNAME | 隔离环境测试账号 |
| AUTH_BROWSER_PASSWORD | 对应测试密码，不提交到仓库 |

本地回环地址可测试 HTTP + SameSite=Lax；生产需按真实 HTTPS、Secure/SameSite 和浏览器 Cookie 政策验收。用全新浏览器上下文测试跨域登录 Cookie、确定的双标签页锁等待、延迟失败响应、被动重新认证不注销其他标签页，以及显式注销。测试主动制造一个 401/refresh 403 来验证客户端失败分支，其他认证请求访问真实 API；它不是完整管理页面 UI 验收，目前也未接入远端 CI。

管理端默认开启自动续期。旧浏览器偏好缓存可能覆盖新的默认值，已有用户需确认该偏好。Web Locks 只覆盖相同前端 origin 且支持该 API 的浏览器；降级路径不保证跨标签页串行，但服务端失败响应仍不会清除其他请求的新 Cookie。详见[第九轮记录](../../docs/qingzhan/production-hardening-phase9-2026-11-07.md)。

## 压测烟测（企业稳态③）

轻量本地脚本（无额外依赖；**不要**塞进默认 CI）：

```bash
# 仓库根；server 需已监听 APP_PORT（默认 5320）
pnpm test:load:smoke
```

详见 `docs/qingzhan/backup-migrate.md` §6 与 `scripts/qingzhan/load-smoke.mjs` 头注释。

## 生产加固与升级

见 [首批生产加固记录](../../docs/qingzhan/production-hardening-2026-11-07.md)，包含权限数据迁移、安全管理员初始化、代理配置与本批验证边界。生产环境禁止演示 seed。

[第十轮菜单与编辑版本修复](../../docs/qingzhan/production-hardening-phase10-2026-11-07.md) 新增管理编辑版本迁移。用户/角色/菜单 PUT 必须携带列表读取的 `version`，旧版本返回 409；管理端表单与状态切换已配套修改。更新时可选菜单字段省略保留、meta 显式对象整体替换；角色页面授权必须显式包含祖先。旧客户端需要同步升级，历史缺祖先授权需要管理员复核；迁移不自动扩大权限。完整语义见 [API 合同](../../规则/api-contract-vben.md)。

后续记录：[授权事务与真实环境验证](../../docs/qingzhan/production-hardening-phase2-2026-11-07.md)、[输入边界与分页兼容性](../../docs/qingzhan/production-hardening-phase3-2026-11-07.md)。管理分页现在会拒绝非法值和超过 100 的 pageSize，客户端应遵循更新后的参数约定。

[第四轮深挖记录](../../docs/qingzhan/production-hardening-phase4-2026-11-07.md)补充部门并发、持久化字典版本、一次性票据、镜像及备份恢复验证。升级本轮代码前必须应用 `20261107020000_dictionary_revision`；验证码票据并不提供服务端人机验证能力。
