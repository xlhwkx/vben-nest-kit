import { INestApplication, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Minimal contract e2e (api-contract-vben.md).
 * Requires Compose PG+Redis and apps/server/.env (seed: vben/123456).
 * Throttle: raised + memory so login cases do not trip 429 mid-suite.
 */
describe('Auth + Health (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken = '';
  let refreshCookie = '';

  beforeAll(async () => {
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.THROTTLE_LOGIN_TTL_MS = '60000';

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
  });

  afterAll(async () => {
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

    // Must NOT be envelope
    expect(typeof res.body === 'object' && res.body !== null && 'code' in res.body).toBe(
      false,
    );
    const token =
      typeof res.body === 'string'
        ? res.body
        : typeof res.text === 'string'
          ? res.text.replace(/^"|"$/g, '')
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
    // clearCookie typically sets Max-Age=0 / Expires in the past / empty value
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
});