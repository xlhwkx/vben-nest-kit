import { MetricsService } from './metrics.service';

describe('metricsService', () => {
  it('exposes prometheus counters for http and auth', () => {
    const m = new MetricsService();
    m.observeHttp(200, 12);
    m.observeHttp(500, 40);
    m.incLoginSuccess();
    m.incLoginFailed();
    m.incLoginFailClosed();
    m.incHealthLive();
    m.incHealthReady(true);
    const text = m.toPrometheus();
    expect(text).toContain('qingzhan_http_requests_total 2');
    expect(text).toContain('qingzhan_http_errors_total 1');
    expect(text).toContain('qingzhan_auth_login_success_total 1');
    expect(text).toContain('qingzhan_auth_login_failed_total 1');
    expect(text).toContain('qingzhan_auth_login_fail_closed_total 1');
    expect(text).toContain('qingzhan_health_live_total 1');
    expect(text).toContain('qingzhan_http_request_duration_ms_count 2');
  });
});
