# 青栈可观测性（运维短文）

> 企业稳态第 1 刀骨架。默认不强制外网；OTLP 需按本文自行挂 SDK。

## 结构化日志

- 每个请求有 `x-request-id`（中间件 + `AsyncLocalStorage`）。
- `auth.lock_unavailable` / 登录失败等关键路径打 **JSON** 日志，字段含 `requestId`、`code`（业务码如 `AUTH_LOCK_UNAVAILABLE`），**不**回传 Redis/堆栈细节给客户端。
- 可用 `StructuredLogger`（`apps/server/src/observability/structured-logger.ts`）扩展其它模块。

## Health

| 路径 | 含义 |
| --- | --- |
| `GET /api/health/live`（及 `/api/v1/...`） | 进程存活 |
| `GET /api/health/ready` | Postgres + Redis；失败 **503** |
| `GET /api/health/metrics` | Prometheus 文本（见下） |

## 指标（Prometheus）

- 端点：`GET /api/health/metrics`（`SkipEnvelope`，纯文本）。
- 默认 **开启**（`METRICS_ENABLED` 未设或 true）。设 `METRICS_ENABLED=false` → 404。
- 可选鉴权：设 `METRICS_TOKEN=...` 后须 `Authorization: Bearer <token>`（否则 401）。**约定仅内网 / sidecar 抓取**，勿对公网裸奔。
- 已暴露：`qingzhan_http_requests_total`、延迟直方图、`qingzhan_auth_login_*`（含 `fail_closed`）、health live/ready 计数。

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
