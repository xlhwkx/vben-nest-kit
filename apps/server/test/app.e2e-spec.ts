/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-non-null-assertion -- e2e harness */
/* oxlint-disable typescript/no-require-imports, eslint/no-nested-ternary, typescript/no-non-null-assertion -- e2e harness */
import {
  INestApplication,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RedisService } from '../src/redis/redis.service';

/**
 * Minimal contract e2e (api-contract-vben.md).
 * Requires Compose PG+Redis and apps/server/.env (seed: vben/123456).
 * Throttle + auth-fail limits raised so suite login traffic does not 429.
 */
describe('Auth + Health (e2e)', () => {
  let app: INestApplication<App>;
  let redis: RedisService;
  let accessToken = '';
  let refreshCookie = '';

  beforeAll(async () => {
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.THROTTLE_LOGIN_TTL_MS = '60000';
    process.env.AUTH_FAIL_MAX = '5';
    process.env.AUTH_FAIL_USER_MAX = '5';
    process.env.AUTH_FAIL_IP_MAX = '10000';
    process.env.AUTH_FAIL_WINDOW_SEC = '900';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    redis = app.get(RedisService);

    // Clear leftover keys from prior runs / live curls (best-effort)
    for (let i = 0; i < 10; i++) {
      if (await redis.ping()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      const client = redis.getClient();
      const keys = await client.keys('auth:fail:*');
      if (keys.length > 0) await client.del(...keys);
    } catch {
      // ignore — suite raises AUTH_FAIL_* high enough
    }
  });

  afterAll(async () => {
    try {
      const client = redis.getClient();
      const keys = await client.keys('auth:fail:*');
      if (keys.length > 0) await client.del(...keys);
    } catch {
      // ignore
    }
    await app.close();
  });

  it('GET /api/v1/health/live → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toBeTruthy();
  });

  it('GET /api/v1/health/ready → 200 (PG+Redis)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toBeTruthy();
  });

  it('POST /api/auth/login wrong password → 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: 'wrong-password' })
      .expect(403);
    expect(res.body.code).toBe(-1);
    expect(res.body.data).toBeNull();
  });

  it('POST /api/auth/login vben/123456 → 200 + jwt cookie + accessToken, no password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.error).toBeNull();
    expect(res.body.data?.accessToken).toEqual(expect.any(String));
    expect(res.body.data.accessToken.length).toBeGreaterThan(20);
    expect(res.body.data.username).toBe('vben');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const jwt = cookies.find((c) => c.startsWith('jwt='));
    expect(jwt).toBeTruthy();
    refreshCookie = jwt!.split(';')[0];
    accessToken = res.body.data.accessToken as string;
  });

  it('GET /api/user/info with Bearer → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/user/info')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data?.username).toBe('vben');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('GET /api/auth/codes with Bearer → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/codes')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/menu/all with Bearer → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/menu/all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toBeTruthy();
  });

  it('GET /api/user/info without token → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/user/info')
      .expect(401);
    expect(res.body.code).toBe(-1);
    expect(res.body.data).toBeNull();
  });

  it('POST /api/auth/refresh with Cookie → pure accessToken string', async () => {
    expect(refreshCookie).toMatch(/^jwt=/);
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);

    expect(
      typeof res.body === 'object' && res.body !== null && 'code' in res.body,
    ).toBe(false);
    const token =
      typeof res.body === 'string'
        ? res.body
        : typeof res.text === 'string'
          ? res.text.replaceAll(/^"|"$/g, '')
          : '';
    expect(token.length).toBeGreaterThan(20);
    accessToken = token;

    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const jwt = cookies.find((c) => c.startsWith('jwt='));
    if (jwt) {
      refreshCookie = jwt.split(';')[0];
    }
  });

  it('POST /api/auth/logout clears jwt cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(res.body.code).toBe(0);

    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const jwt = cookies.find((c) => c.startsWith('jwt='));
    expect(jwt).toBeTruthy();
    expect(jwt!.toLowerCase()).toMatch(/max-age=0|expires=|jwt=;/);
  });

  it('jack cannot list audit → 403 (optional)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'jack', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;

    const res = await request(app.getHttpServer())
      .get('/api/system/audit/list')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.code).toBe(-1);
  });

  it('POST /api/upload without file → 400 (optional)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;

    const res = await request(app.getHttpServer())
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(res.body.code).toBe(-1);
  });

  it('POST /api/upload MZ bytes + image/png → 400', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;

    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const res = await request(app.getHttpServer())
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', mz, { filename: 'evil.png', contentType: 'image/png' })
      .expect(400);
    expect(res.body.code).toBe(-1);
  });

  it('POST /api/upload real PNG → 200', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    const token = login.body.data.accessToken as string;

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const res = await request(app.getHttpServer())
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', png, { filename: 'pixel.png', contentType: 'image/png' })
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data?.url).toEqual(expect.any(String));
  });

  it('auth:fail lock → 429 even with correct password; success clears', async () => {
    const lockUser = `lock_${Date.now()}`;
    const userKey = `auth:fail:user:${lockUser.toLowerCase()}`;

    // Trip threshold via Redis (AUTH_FAIL_USER_MAX=5)
    await redis.set(userKey, '5', 120);

    const lockedWrong = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: lockUser, password: 'anything' })
      .expect(429);
    expect(lockedWrong.body.code).toBe(-1);
    expect(String(lockedWrong.body.message)).toMatch(/failed login|try again/i);

    // Seed lock on real user, prove correct password still 429, then clear via del+login
    const vbenKey = 'auth:fail:user:vben';
    await redis.set(vbenKey, '5', 120);
    const lockedOk = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(429);
    expect(String(lockedOk.body.message)).toMatch(/failed login|try again/i);

    await redis.del(vbenKey);
    await redis.set(vbenKey, '2', 120);
    const cleared = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    expect(cleared.body.code).toBe(0);
    const after = await redis.get(vbenKey);
    expect(after === null || after === undefined || after === '').toBe(true);

    await redis.del(userKey);
  });
});
