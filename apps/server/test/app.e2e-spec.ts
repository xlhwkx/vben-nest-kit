/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- e2e harness */
/* oxlint-disable typescript/no-require-imports, eslint/no-nested-ternary, typescript/no-non-null-assertion -- e2e harness */
import { INestApplication, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import request from 'supertest';
import type { App } from 'supertest/types';
import { appFixture } from './app-fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
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
    // Contract login path: captcha not required unless a dedicated suite opts in.
    process.env.CAPTCHA_REQUIRED = 'false';
    process.env.CAPTCHA_E2E_BYPASS = 'false';

    const moduleFixture = await appFixture();

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
      const patterns = ['auth:fail:*', 'qz:throttle:*'];
      for (const pattern of patterns) {
        const keys = await client.keys(pattern);
        if (keys.length > 0) await client.del(...keys);
      }
    } catch {
      // ignore — suite raises AUTH_FAIL_* / THROTTLE_* high enough
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
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toBeTruthy();
  });

  it('GET /api/v1/health/ready → 200 (PG+Redis)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
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
    const res = await request(app.getHttpServer()).get('/api/user/info').expect(401);
    expect(res.body.code).toBe(-1);
    expect(res.body.data).toBeNull();
  });

  it('POST /api/auth/refresh with Cookie → pure accessToken string', async () => {
    expect(refreshCookie).toMatch(/^jwt=/);
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);

    expect(typeof res.body === 'object' && res.body !== null && 'code' in res.body).toBe(false);
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
  it('GET /api/table/list with Bearer → items+total', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/table/list')
      .query({ page: 1, pageSize: 10 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data?.items)).toBe(true);
    expect(res.body.data.items).toHaveLength(10);
    expect(res.body.data.total).toBe(100);
    expect(res.body).not.toHaveProperty('password');
  });

  it('GET /api/table/list without token → 401', async () => {
    await request(app.getHttpServer()).get('/api/table/list').expect(401);
  });

  it('GET /api/status?status=500 → 500 error envelope (public)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/status')
      .query({ status: 500 })
      .expect(500);
    expect(res.body.code).toBe(-1);
    expect(res.body.data).toBeNull();
    expect(String(res.body.message)).toContain('500');
  });

  it('GET /api/dict/all with Bearer → record of enabled items', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dict/all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual(expect.any(Object));
    expect(res.body.data.user_gender).toEqual(expect.any(Array));
    expect(res.body.data.user_gender.length).toBeGreaterThan(0);
    expect(res.body.data.user_gender[0]).toEqual(
      expect.objectContaining({
        label: expect.any(String),
        value: expect.anything(),
      }),
    );
  });

  it('GET /api/dict/data?code=user_gender → enabled items', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dict/data')
      .query({ code: 'user_gender' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /api/dict/version → number', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dict/version')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(typeof res.body.data).toBe('number');
  });

  it('GET /api/system/role/list → items+total with permissions[]', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/system/role/list')
      .query({ page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data?.items)).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
    expect(res.body.data.items.length).toBeGreaterThan(0);
    const row = res.body.data.items[0];
    expect(row).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        code: expect.any(String),
        status: expect.any(Number),
        createTime: expect.any(String),
        permissions: expect.any(Array),
      }),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    // createTime ISO-8601 UTC on role list
    expect(row.createTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('POST /api/system/role without code → auto slug; PUT {status,version} partial OK', async () => {
    const stamp = Date.now().toString(36);
    const created = await request(app.getHttpServer())
      .post('/api/system/role')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Parity Role ${stamp}`,
        status: 1,
        remark: 'mock-field-parity',
      })
      .expect(200);
    expect(created.body.code).toBe(0);
    expect(created.body.data?.id).toEqual(expect.any(String));
    expect(created.body.data?.code).toEqual(expect.any(String));
    expect(created.body.data.code.length).toBeGreaterThan(0);
    expect(created.body.data.status).toBe(1);

    const id = created.body.data.id as string;
    const patched = await request(app.getHttpServer())
      .put(`/api/system/role/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 0, version: created.body.data.version })
      .expect(200);
    expect(patched.body.code).toBe(0);
    expect(patched.body.data?.status).toBe(0);
    expect(patched.body.data?.name).toBe(`Parity Role ${stamp}`);
    expect(patched.body.data?.code).toBe(created.body.data.code);

    await request(app.getHttpServer())
      .delete(`/api/system/role/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /api/system/user/list → items+total roles[] ISO createTime, no password', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/system/user/list')
      .query({ page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data?.items)).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
    expect(res.body.data.items.length).toBeGreaterThan(0);
    const row = res.body.data.items[0];
    expect(row).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        username: expect.any(String),
        status: expect.any(Number),
        gender: expect.any(Number),
        createTime: expect.any(String),
        roles: expect.any(Array),
      }),
    );
    expect(row.createTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    // playground type historically said permissions; Nest/contract use roles
    expect(row).not.toHaveProperty('permissions');
  });

  it('POST /api/system/user without username/password → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/system/user')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'No Creds', status: 1 })
      .expect(400);
    expect(res.body.code).not.toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('POST /api/system/user with username+password → 200 ISO createTime, no password echo', async () => {
    const stamp = Date.now().toString(36);
    const username = `parity_u_${stamp}`;
    const created = await request(app.getHttpServer())
      .post('/api/system/user')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username,
        password: 'secret12',
        name: `Parity User ${stamp}`,
        status: 1,
        gender: 2,
        roles: [],
      })
      .expect(200);
    expect(created.body.code).toBe(0);
    expect(created.body.data?.id).toEqual(expect.any(String));
    expect(created.body.data?.username).toBe(username);
    expect(created.body.data?.name).toBe(`Parity User ${stamp}`);
    expect(created.body.data?.roles).toEqual([]);
    expect(created.body.data.createTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(JSON.stringify(created.body)).not.toMatch(/password/i);

    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`/api/system/user/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('POST /api/system/user password shorter than 6 → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/system/user')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username: `short_pw_${Date.now().toString(36)}`,
        password: '12345',
        name: 'Short Password',
        status: 1,
      })
      .expect(400);
    expect(res.body.code).not.toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('GET /api/system/user/list YYYY-MM-DD range uses Asia/Shanghai day bounds', async () => {
    const stamp = Date.now().toString(36);
    const username = `cst_u_${stamp}`;
    const created = await request(app.getHttpServer())
      .post('/api/system/user')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username,
        password: 'secret12',
        name: `CST User ${stamp}`,
        status: 1,
        gender: 2,
        roles: [],
      })
      .expect(200);
    const id = created.body.data.id as string;
    const createTime = created.body.data.createTime as string;
    const shanghaiDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(createTime));

    const hit = await request(app.getHttpServer())
      .get('/api/system/user/list')
      .query({
        page: 1,
        pageSize: 50,
        startTime: shanghaiDay,
        endTime: shanghaiDay,
      })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(hit.body.code).toBe(0);
    expect(hit.body.data.items.some((u: { id: string }) => u.id === id)).toBe(true);

    const miss = await request(app.getHttpServer())
      .get('/api/system/user/list')
      .query({
        page: 1,
        pageSize: 50,
        startTime: '2000-01-01',
        endTime: '2000-01-01',
      })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(miss.body.data.items.some((u: { id: string }) => u.id === id)).toBe(false);

    await request(app.getHttpServer())
      .delete(`/api/system/user/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('POST /api/system/user with roles[] binds role ids', async () => {
    const stamp = Date.now().toString(36);
    // Bind a role whose grants are within this administrator's authority.
    const roleResponse = await request(app.getHttpServer())
      .post('/api/system/role')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Role Binding ${stamp}`,
        code: `rolebind_${stamp}`,
        permissions: [],
      })
      .expect(200);
    const roleId = roleResponse.body.data.id as string;
    const username = `rolebind_${stamp}`;
    const created = await request(app.getHttpServer())
      .post('/api/system/user')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        username,
        password: 'secret12',
        name: `Role Bind ${stamp}`,
        status: 1,
        roles: [roleId],
      })
      .expect(200);
    expect(created.body.code).toBe(0);
    expect(created.body.data.roles).toEqual([roleId]);
    expect(JSON.stringify(created.body)).not.toMatch(/password/i);

    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`/api/system/user/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/system/role/${roleId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /api/timezone/getTimezoneOptions → public label/value[]', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/timezone/getTimezoneOptions')
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        label: expect.any(String),
        value: expect.any(String),
      }),
    );
    expect(res.body.data.some((o: { value: string }) => o.value === 'Asia/Shanghai')).toBe(true);
  });

  it('GET /api/timezone/getTimezone without token → 401', async () => {
    await request(app.getHttpServer()).get('/api/timezone/getTimezone').expect(401);
  });

  it('timezone get/set round-trip + invalid rejected', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/timezone/getTimezone')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(before.body.code).toBe(0);
    expect(before.body).not.toHaveProperty('password');

    await request(app.getHttpServer())
      .post('/api/timezone/setTimezone')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ timezone: 'Not/AZone' })
      .expect(400);

    const setOk = await request(app.getHttpServer())
      .post('/api/timezone/setTimezone')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ timezone: 'Asia/Shanghai' })
      .expect(200);
    expect(setOk.body.code).toBe(0);
    expect(setOk.body.data).toEqual({});

    const after = await request(app.getHttpServer())
      .get('/api/timezone/getTimezone')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(after.body.code).toBe(0);
    expect(after.body.data).toBe('Asia/Shanghai');

    const v1 = await request(app.getHttpServer())
      .get('/api/v1/timezone/getTimezone')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(v1.body.data).toBe('Asia/Shanghai');
  });

  it('GET /api/demo/bigint with Bearer → raw JSON keeps oversized id literals', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/demo/bigint')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).toContain(
      '"id": 123456789012345678901234567890123456789012345678901234567890',
    );
    expect(res.text).not.toMatch(/password/i);
    const parsed = JSON.parse(res.text) as {
      code: number;
      data: unknown;
    };
    expect(parsed.code).toBe(0);
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it('GET /api/demo/bigint without token → 401', async () => {
    await request(app.getHttpServer()).get('/api/demo/bigint').expect(401);
  });
});

describe('Captcha harness (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Dedicated app; flags toggled per-test via process.env (CaptchaService reads live).
    process.env.CAPTCHA_REQUIRED = 'false';
    process.env.CAPTCHA_E2E_BYPASS = 'false';
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.AUTH_FAIL_MAX = '10000';
    process.env.AUTH_FAIL_USER_MAX = '10000';
    process.env.AUTH_FAIL_IP_MAX = '10000';

    const moduleFixture = await appFixture();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    try {
      const redis = app.get(RedisService);
      for (let i = 0; i < 10; i++) {
        if (await redis.ping()) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const client = redis.getClient();
      for (const pattern of ['auth:fail:*', 'captcha:*', 'qz:throttle:*']) {
        const keys = await client.keys(pattern);
        if (keys.length > 0) await client.del(...keys);
      }
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    process.env.CAPTCHA_REQUIRED = 'false';
    process.env.CAPTCHA_E2E_BYPASS = 'false';
  });

  afterAll(async () => {
    await app?.close();
    process.env.CAPTCHA_REQUIRED = 'false';
    process.env.CAPTCHA_E2E_BYPASS = 'false';
  });

  async function clearAuthFail(): Promise<void> {
    try {
      const redis = app.get(RedisService);
      const client = redis.getClient();
      for (const pattern of ['auth:fail:*', 'qz:throttle:*']) {
        const keys = await client.keys(pattern);
        if (keys.length > 0) await client.del(...keys);
      }
    } catch {
      // ignore
    }
  }

  it('CAPTCHA_REQUIRED without token → 400', async () => {
    await clearAuthFail();
    process.env.CAPTCHA_REQUIRED = 'true';
    process.env.CAPTCHA_E2E_BYPASS = 'false';
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' });
    expect(res.status).toBe(400);
    expect(String(res.body.error ?? res.body.message)).toMatch(/captcha/i);
  });

  it('CAPTCHA_REQUIRED + GET /auth/captcha then login → 200', async () => {
    await clearAuthFail();
    process.env.CAPTCHA_REQUIRED = 'true';
    process.env.CAPTCHA_E2E_BYPASS = 'false';

    const ch = await request(app.getHttpServer()).get('/api/auth/captcha').expect(200);
    expect(ch.body.code).toBe(0);
    expect(ch.body.data.captchaId).toBeTruthy();
    expect(ch.body.data.captchaToken).toBeTruthy();

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        username: 'vben',
        password: '123456',
        captchaId: ch.body.data.captchaId,
        captchaToken: ch.body.data.captchaToken,
      })
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data).not.toHaveProperty('password');
  });

  it('CAPTCHA_E2E_BYPASS=1 → login without captcha → 200', async () => {
    await clearAuthFail();
    process.env.CAPTCHA_REQUIRED = 'true';
    process.env.CAPTCHA_E2E_BYPASS = 'true';
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});

describe('Login throttle fail-closed (e2e)', () => {
  let app: INestApplication<App>;
  let redis: RedisService;

  beforeAll(async () => {
    // Dedicated app with Redis storage so login throttler can fail-closed.
    process.env.THROTTLE_STORAGE = 'redis';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.THROTTLE_LOGIN_TTL_MS = '60000';
    process.env.AUTH_FAIL_USER_MAX = '10000';
    process.env.AUTH_FAIL_IP_MAX = '10000';

    const moduleFixture = await appFixture();

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
    for (let i = 0; i < 10; i++) {
      if (await redis.ping()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('Redis eval failure on login → 503 Rate limit unavailable', async () => {
    // ioredis attaches commands on a prototype/proxy; jest.spyOn(client, 'eval')
    // is unreliable under Jest+Node ESM on CI. Stub getClient instead.
    const evalMock = jest.fn().mockRejectedValue(new Error('simulated redis down'));
    const getClientSpy = jest.spyOn(redis, 'getClient').mockReturnValue({
      eval: evalMock,
    } as unknown as ReturnType<RedisService['getClient']>);
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'vben', password: '123456' })
        .expect(503);
      expect(evalMock).toHaveBeenCalled();
      expect(res.body.code).toBe(-1);
      expect(String(res.body.message)).toMatch(/rate limit unavailable/i);
    } finally {
      getClientSpy.mockRestore();
    }
  });
});

describe('Login auth:fail lock fail-closed (e2e)', () => {
  let app: INestApplication<App>;
  let redis: RedisService;

  beforeAll(async () => {
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.AUTH_FAIL_USER_MAX = '5';
    process.env.AUTH_FAIL_IP_MAX = '10000';
    process.env.METRICS_ENABLED = 'true';

    const moduleFixture = await appFixture();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Redis counter read failure on login → 503 Login lock unavailable', async () => {
    const spy = jest
      .spyOn(redis, 'readCounterWithTtlStrict')
      .mockRejectedValue(new Error('simulated redis down for auth:fail'));
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'vben', password: '123456' })
        .expect(503);
      expect(spy).toHaveBeenCalled();
      expect(res.body.code).toBe(-1);
      expect(String(res.body.message)).toMatch(/login lock unavailable/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('GET /api/health/metrics returns prometheus text', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/metrics').expect(200);
    expect(String(res.text)).toMatch(/qingzhan_http_requests_total/);
    expect(String(res.text)).toMatch(/qingzhan_auth_login_fail_closed_total/);
  });
});
