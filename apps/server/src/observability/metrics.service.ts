import { Injectable } from '@nestjs/common';

type Hist = { count: number; sumMs: number; buckets: number[] };

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * In-process Prometheus-text metrics (no prom-client dependency).
 * Multi-instance scrapers must scrape each pod; Redis-backed metrics are out of scope for v0.2.
 */
@Injectable()
export class MetricsService {
  private httpRequests = 0;
  private httpErrors = 0;
  private readonly httpResponses = new Map<number, number>();
  private readonly httpLatency: Hist = {
    count: 0,
    sumMs: 0,
    buckets: LATENCY_BUCKETS_MS.map(() => 0),
  };
  private loginSuccess = 0;
  private loginFailed = 0;
  private loginLocked = 0;
  private loginFailClosed = 0;
  private healthLive = 0;
  private healthReadyOk = 0;
  private healthReadyFail = 0;
  private auditActive = 0;
  private auditPending = 0;
  private auditFailed = 0;
  private readonly auditDropped = { capacity: 0, shutdown: 0 };
  private readonly startedAt = Date.now();

  observeHttp(status: number, durationMs: number): void {
    this.httpRequests += 1;
    this.httpResponses.set(status, (this.httpResponses.get(status) ?? 0) + 1);
    if (status >= 500) this.httpErrors += 1;
    this.httpLatency.count += 1;
    this.httpLatency.sumMs += durationMs;
    // Exclusive bucket hits; export path accumulates for Prometheus le=.
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      if (durationMs <= LATENCY_BUCKETS_MS[i]) {
        this.httpLatency.buckets[i] += 1;
        break;
      }
    }
  }

  incLoginSuccess(): void {
    this.loginSuccess += 1;
  }
  incLoginFailed(): void {
    this.loginFailed += 1;
  }
  incLoginLocked(): void {
    this.loginLocked += 1;
  }
  incLoginFailClosed(): void {
    this.loginFailClosed += 1;
  }
  incHealthLive(): void {
    this.healthLive += 1;
  }
  incHealthReady(ok: boolean): void {
    if (ok) this.healthReadyOk += 1;
    else this.healthReadyFail += 1;
  }

  setAuditBacklog(active: number, pending: number): void {
    this.auditActive = active;
    this.auditPending = pending;
  }

  incAuditDropped(reason: 'capacity' | 'shutdown'): void {
    this.auditDropped[reason]++;
  }

  incAuditWriteFailed(): void {
    this.auditFailed++;
  }

  /** Prometheus text exposition (OpenMetrics-ish). */
  toPrometheus(): string {
    const lines: string[] = [];
    const n = (name: string, help: string, type: string) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };
    n('qingzhan_process_uptime_seconds', 'Process uptime in seconds', 'gauge');
    lines.push(
      `qingzhan_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(3)}`,
    );

    n('qingzhan_http_requests_total', 'HTTP requests handled', 'counter');
    n('qingzhan_audit_background_active', 'Active best-effort audit writes', 'gauge');
    lines.push(`qingzhan_audit_background_active ${this.auditActive}`);
    n('qingzhan_audit_background_pending', 'Active and queued best-effort audit writes', 'gauge');
    lines.push(`qingzhan_audit_background_pending ${this.auditPending}`);
    n('qingzhan_audit_background_failed_total', 'Failed best-effort audit writes', 'counter');
    lines.push(`qingzhan_audit_background_failed_total ${this.auditFailed}`);
    n('qingzhan_audit_background_dropped_total', 'Dropped best-effort audit records', 'counter');
    for (const reason of ['capacity', 'shutdown'] as const) {
      lines.push(
        `qingzhan_audit_background_dropped_total{reason="${reason}"} ${this.auditDropped[reason]}`,
      );
    }
    lines.push(`qingzhan_http_requests_total ${this.httpRequests}`);
    n('qingzhan_http_errors_total', 'HTTP 5xx responses', 'counter');
    lines.push(`qingzhan_http_errors_total ${this.httpErrors}`);
    n(
      'qingzhan_http_responses_total',
      'HTTP responses by status (499 means disconnected)',
      'counter',
    );
    for (const [status, count] of [...this.httpResponses].sort(([a], [b]) => a - b)) {
      lines.push(`qingzhan_http_responses_total{status="${status}"} ${count}`);
    }

    n('qingzhan_http_request_duration_ms', 'HTTP request duration in milliseconds', 'histogram');
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      cumulative += this.httpLatency.buckets[i];
      lines.push(
        `qingzhan_http_request_duration_ms_bucket{le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`,
      );
    }
    lines.push(
      `qingzhan_http_request_duration_ms_bucket{le="+Inf"} ${this.httpLatency.count}`,
      `qingzhan_http_request_duration_ms_sum ${this.httpLatency.sumMs.toFixed(3)}`,
      `qingzhan_http_request_duration_ms_count ${this.httpLatency.count}`,
    );

    n('qingzhan_auth_login_success_total', 'Successful logins', 'counter');
    lines.push(`qingzhan_auth_login_success_total ${this.loginSuccess}`);
    n('qingzhan_auth_login_failed_total', 'Failed logins (bad credentials)', 'counter');
    lines.push(`qingzhan_auth_login_failed_total ${this.loginFailed}`);
    n('qingzhan_auth_login_locked_total', 'Logins rejected by fail lock', 'counter');
    lines.push(`qingzhan_auth_login_locked_total ${this.loginLocked}`);
    n(
      'qingzhan_auth_login_fail_closed_total',
      'Logins rejected because Redis lock store unavailable',
      'counter',
    );
    lines.push(`qingzhan_auth_login_fail_closed_total ${this.loginFailClosed}`);

    n('qingzhan_health_live_total', 'Liveness probe hits', 'counter');
    lines.push(`qingzhan_health_live_total ${this.healthLive}`);
    n('qingzhan_health_ready_ok_total', 'Ready probe success', 'counter');
    lines.push(`qingzhan_health_ready_ok_total ${this.healthReadyOk}`);
    n('qingzhan_health_ready_fail_total', 'Ready probe failure', 'counter');
    lines.push(`qingzhan_health_ready_fail_total ${this.healthReadyFail}`);

    return `${lines.join('\n')}\n`;
  }
}
