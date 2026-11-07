# 青栈可观测性（运维短文）

> 企业稳态第 1 刀骨架。默认不强制外网；OTLP 需按本文自行挂 SDK。

## 结构化日志

- 每个请求有 `x-request-id`（中间件 + `AsyncLocalStorage`）。
- `auth.lock_unavailable` / 登录失败等关键路径打 **JSON** 日志，字段含 `requestId`、`code`（业务码如 `AUTH_LOCK_UNAVAILABLE`），**不**回传 Redis/堆栈细节给客户端。
- 可用 `StructuredLogger`（`apps/server/src/observability/structured-logger.ts`）扩展其它模块。
- 全局异常过滤器为 5xx 输出 `http.server_error` JSON 事件，包含 requestId、方法、去掉查询串的路径、状态、异常类型与最多 12 行调用帧；不记录请求体、查询参数、凭证或异常消息。

## Health

| 路径 | 含义 |
| --- | --- |
| `GET /api/health/live`（及 `/api/v1/...`） | 进程存活 |
| `GET /api/health/ready` | Postgres + Redis；失败 **503**；每 IP 每分钟 30 次；同实例并发合并，成功/失败缓存 1 秒 |
| `GET /api/health/metrics` | Prometheus 文本（见下） |

## 指标（Prometheus）

- 端点：`GET /api/health/metrics`（`SkipEnvelope`，纯文本）。
- 默认 **开启**（`METRICS_ENABLED` 未设或 true）。设 `METRICS_ENABLED=false` → 404。
- 可选鉴权：设 `METRICS_TOKEN=...` 后须 `Authorization: Bearer <token>`（否则 401）。**约定仅内网 / sidecar 抓取**，勿对公网裸奔。
- **生产硬门槛**：`NODE_ENV=production` 且指标未关时 **必须** 配置 `METRICS_TOKEN`，否则进程拒绝启动；或设 `METRICS_ENABLED=false`。详见 `docs/qingzhan/deploy.md`。
- 已暴露：`qingzhan_http_requests_total`、延迟直方图、`qingzhan_auth_login_*`（含 `fail_closed`）、health live/ready 计数。
- HTTP 使用响应生命周期 middleware 统计，覆盖 Guard 拒绝的 401/403/429/503 与 404；增加 `qingzhan_http_responses_total{status="..."}`。响应未完成就断连记作 499，finish/close 只统计一次，metrics 抓取自身不进入 HTTP 总量。

## 审计停机等待

尽力审计使用有界后台队列：`AUDIT_BACKGROUND_MAX_PENDING=256` 包含活动写入，`AUDIT_BACKGROUND_CONCURRENCY=4` 限制同时发出的数据库写入。容量满时丢弃新尽力审计；开始停机 drain 后拒绝新增，但继续处理已接收的队列。身份、请求上下文和脱敏明细在入队时快照，避免排队后串到其他请求上下文。

- `qingzhan_audit_background_active`：活动写入数。
- `qingzhan_audit_background_pending`：活动与排队总数。
- `qingzhan_audit_background_dropped_total{reason="capacity|shutdown"}`：按有限原因标签记录丢弃。
- `qingzhan_audit_background_failed_total`：实际数据库写入失败数。

建议对容量丢弃计数增长、积压持续接近上限、写入失败增长告警。生产模板默认关闭 metrics，启用告警前必须同时开启指标、设置抓取 token 并配置采集。计数按进程生命周期累计，重启归零。事务内管理/认证成功审计不经过此队列，不受其满额丢弃策略影响；尽力审计仍不提供可靠投递保证。

PostgreSQL 连接池默认 10，连接/池等待上限 3000ms，服务端单条语句默认 15000ms（`DATABASE_POOL_MAX`、`DATABASE_CONNECT_TIMEOUT_MS`、`DATABASE_STATEMENT_TIMEOUT_MS`）。服务端超时实际取消 SQL；不会通过给 Promise 加超时后提前释放活动预算而留下无限底层查询。事务自身还受各服务的事务/锁等待限制。自定义长查询应显式评估预算，不能盲目调大池或并发。

HTTP drain 结束后，服务在剩余 `SHUTDOWN_TIMEOUT_MS` 预算内等待尽力写入的审计，再销毁数据库连接。用户/角色/菜单/部门/字典管理和有效认证会话的成功审计直接参与业务事务，失败会回滚。其他审计仍可能在崩溃或超时中丢失；没有实现 outbox。最新范围见[第四轮记录](./production-hardening-phase4-2026-11-07.md)。

抓取示例（Prometheus）：

```yaml
scrape_configs:
  - job_name: qingzhan
    metrics_path: /api/health/metrics
    static_configs:
      - targets: ['qingzhan-server:5320']
    # authorization:
    #   type: Bearer
    #   credentials: <METRICS_TOKEN>
```

## OpenTelemetry

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OTEL_ENABLED` | false | 总开关 |
| `OTEL_TRACES_EXPORTER` | none | `none` \| `console` \| `otlp` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | 仅文档钩子；进程 **不会**自动拨号 |
| `OTEL_SERVICE_NAME` | qingzhan-server | 服务名 |

- `OTEL_ENABLED=true` + `OTEL_TRACES_EXPORTER=console`：span 起止写入结构化日志（零外网）。
- `otlp`：当前仓库只打 warn + 文档；接真导出请安装 `@opentelemetry/sdk-node` + OTLP exporter，在 `TracingService.onModuleInit` 或 `main.ts` 启动前注册（保持默认关）。

## auth:fail 与 Redis fail-closed

- 登录限流（throttler `login`）与 **auth:fail 锁定检查/失败计数** 在 Redis 不可用时一律 **HTTP 503**（`Login lock unavailable` / `Rate limit unavailable`），禁止静默放行爆破。
- 证据：单测 `auth-fail-closed.spec.ts`；e2e `Login auth:fail lock fail-closed`、`Login throttle fail-closed`。
