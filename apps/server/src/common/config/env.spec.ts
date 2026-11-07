import { assertProductionEnv, loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://qingzhan:qingzhan@localhost:5432/qingzhan',
  REDIS_URL: 'redis://:qingzhan@localhost:6379/0',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('loadEnv', () => {
  it.each([
    'UPLOAD_MAX_CONCURRENT',
    'AUDIT_BACKGROUND_MAX_PENDING',
    'AUDIT_BACKGROUND_CONCURRENCY',
    'DATABASE_POOL_MAX',
    'DATABASE_CONNECT_TIMEOUT_MS',
    'DATABASE_STATEMENT_TIMEOUT_MS',
  ])('rejects invalid resource budget %s', (key) => {
    for (const value of ['0', '-1', '1.5', '999999999']) {
      expect(() => loadEnv({ ...base, [key]: value })).toThrow(key);
    }
  });
  it('rejects audit concurrency above its pending budget', () => {
    expect(() =>
      loadEnv({
        ...base,
        AUDIT_BACKGROUND_MAX_PENDING: '2',
        AUDIT_BACKGROUND_CONCURRENCY: '3',
      }),
    ).toThrow('AUDIT_BACKGROUND_CONCURRENCY');
  });
  it('requires complete S3 credentials only when the S3 driver is selected', () => {
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow('S3_BUCKET');
    expect(() =>
      loadEnv({
        ...base,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'bucket',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: ' ',
      }),
    ).toThrow('S3_SECRET_ACCESS_KEY');
    expect(
      loadEnv({
        ...base,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'bucket',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      }).STORAGE_DRIVER,
    ).toBe('s3');
    expect(loadEnv({ ...base, S3_BUCKET: '', S3_SECRET_ACCESS_KEY: '' }).STORAGE_DRIVER).toBe(
      'local',
    );
    expect(() => loadEnv({ ...base, S3_ENDPOINT: 'https://user:secret@example.test' })).toThrow(
      'S3_ENDPOINT',
    );
  });
  it.each(['tru', 'yes', 'on', '2'])('rejects misspelled security flags %s', (value) => {
    for (const key of ['CAPTCHA_REQUIRED', 'COOKIE_SECURE', 'METRICS_ENABLED', 'SWAGGER_ENABLED']) {
      expect(() => loadEnv({ ...base, [key]: value })).toThrow(key);
    }
  });
  it.each([
    ['true', true],
    ['1', true],
    [' TRUE ', true],
    ['false', false],
    ['0', false],
    ['', false],
  ])('accepts explicit boolean %s', (value, expected) => {
    expect(loadEnv({ ...base, CAPTCHA_REQUIRED: value }).CAPTCHA_REQUIRED).toBe(expected);
  });
  it.each([
    'THROTTLE_TTL_MS',
    'THROTTLE_LIMIT',
    'THROTTLE_LOGIN_TTL_MS',
    'THROTTLE_LOGIN_LIMIT',
    'AUTH_FAIL_MAX',
    'AUTH_FAIL_WINDOW_SEC',
    'AUTH_FAIL_USER_MAX',
    'AUTH_FAIL_IP_MAX',
  ])('requires positive integral %s', (key) => {
    for (const value of ['0', '-1', '1.5', 'Infinity', '2147483648']) {
      expect(() => loadEnv({ ...base, [key]: value })).toThrow(key);
    }
    expect(loadEnv({ ...base, [key]: '1' })).toHaveProperty(key, 1);
  });
  it.each([
    '*',
    'null',
    'https://*.example.com',
    'https://admin.example.com/path',
    'https://admin.example.com?query=1',
    'https://admin.example.com#fragment',
    'https://user:password@admin.example.com',
    'file:///tmp/test',
    'example.com',
  ])('rejects invalid trusted origin %s', (CORS_ORIGINS) => {
    expect(() => loadEnv({ ...base, CORS_ORIGINS })).toThrow('CORS_ORIGINS');
  });
  it('normalizes origins, permits empty CORS and a public URL path prefix', () => {
    expect(
      loadEnv({
        ...base,
        CORS_ORIGINS: ' https://ADMIN.example.com:443/,http://localhost:5173 ',
      }).corsOrigins,
    ).toEqual(['https://admin.example.com', 'http://localhost:5173']);
    expect(loadEnv({ ...base, CORS_ORIGINS: '' }).corsOrigins).toEqual([]);
    expect(
      loadEnv({ ...base, APP_PUBLIC_URL: 'https://api.example.com/prefix' }).APP_PUBLIC_URL,
    ).toBe('https://api.example.com/prefix');
  });
  it('validates public URLs, SMTP ports and queue DB indices without echoing credentials', () => {
    for (const APP_PUBLIC_URL of [
      'javascript:alert(1)',
      'https://user:private-value@example.com',
      'broken',
    ]) {
      expect(() => loadEnv({ ...base, APP_PUBLIC_URL })).toThrow('APP_PUBLIC_URL');
      expect(() => loadEnv({ ...base, APP_PUBLIC_URL })).not.toThrow(/private-value/);
    }
    for (const SMTP_PORT of ['0', '-1', '65536', '1.5']) {
      expect(() => loadEnv({ ...base, SMTP_PORT })).toThrow('SMTP_PORT');
    }
    for (const QUEUE_REDIS_DB of ['-1', '1.5']) {
      expect(() => loadEnv({ ...base, QUEUE_REDIS_DB })).toThrow('QUEUE_REDIS_DB');
    }
    expect(loadEnv({ ...base, QUEUE_REDIS_DB: '0' }).QUEUE_REDIS_DB).toBe(0);
  });
  it.each(['true', '1', '2'])('rejects unsafe proxy trust %s', (TRUST_PROXY) => {
    expect(() => loadEnv({ ...base, TRUST_PROXY })).toThrow(/TRUST_PROXY/);
  });
  it('disables proxy trust by default and accepts explicit ingress CIDRs', () => {
    expect(loadEnv(base).TRUST_PROXY).toBe('');
    expect(loadEnv({ ...base, TRUST_PROXY: '127.0.0.1,10.0.0.0/24' }).TRUST_PROXY).toContain(
      '10.0.0.0/24',
    );
  });
  it('rejects identical signing secrets and insecure cross-site cookies', () => {
    expect(() => loadEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(
      /different/,
    );
    expect(() => loadEnv({ ...base, COOKIE_SAME_SITE: 'none' })).toThrow(/COOKIE_SECURE/);
  });
  it.each([
    { JWT_REFRESH_TTL: 'forever' },
    { APP_PORT: '70000' },
    { UPLOAD_MAX_BYTES: '-1' },
    { SHUTDOWN_TIMEOUT_MS: '0' },
  ])('rejects invalid operational limits %j', (override) => {
    expect(() => loadEnv({ ...base, ...override })).toThrow(/Invalid environment/);
  });
  it('fails fast with clear lines when DATABASE_URL missing', () => {
    expect(() =>
      loadEnv({
        ...base,
        DATABASE_URL: '',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('fails when JWT secret shorter than 32', () => {
    expect(() =>
      loadEnv({
        ...base,
        JWT_ACCESS_SECRET: 'short',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('accepts development with example-like secrets', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-qingzhan',
      JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-qingzhan',
      METRICS_ENABLED: 'true',
    });
    expect(env.NODE_ENV).toBe('development');
  });
});

describe('assertProductionEnv / production loadEnv', () => {
  it('rejects placeholder JWT in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-qingzhan',
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        METRICS_TOKEN: 'tok',
      }),
    ).toThrow(/placeholders/);
  });

  it('rejects CAPTCHA_E2E_BYPASS in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        CAPTCHA_E2E_BYPASS: 'true',
        METRICS_TOKEN: 'tok',
      }),
    ).toThrow(/CAPTCHA_E2E_BYPASS/);
  });

  it('rejects metrics on without METRICS_TOKEN in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        METRICS_ENABLED: 'true',
      }),
    ).toThrow(/METRICS_TOKEN/);
  });

  it('allows production when metrics disabled without token', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      METRICS_ENABLED: 'false',
      COOKIE_SECURE: 'true',
    });
    expect(env.METRICS_ENABLED).toBe(false);
  });

  it('allows production with METRICS_TOKEN', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      METRICS_TOKEN: 'scrape-secret',
      COOKIE_SECURE: 'true',
    });
    expect(env.METRICS_TOKEN).toBe('scrape-secret');
  });

  it('assertProductionEnv is no-op outside production', () => {
    expect(() =>
      assertProductionEnv({
        NODE_ENV: 'test',
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-qingzhan',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-qingzhan',
        CAPTCHA_E2E_BYPASS: true,
        METRICS_ENABLED: true,
      }),
    ).not.toThrow();
  });
});
