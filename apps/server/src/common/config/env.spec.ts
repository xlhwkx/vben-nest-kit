import { assertProductionEnv, loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://qingzhan:qingzhan@localhost:5432/qingzhan',
  REDIS_URL: 'redis://:qingzhan@localhost:6379/0',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('loadEnv', () => {
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
