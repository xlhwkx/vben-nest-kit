import { VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { appFixture } from './app-fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

/** Tests server side effects; does not simulate browser SameSite / third-party-cookie policy. */
describe('browser authentication boundaries and failure windows (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let userId: string;
  const trusted = 'https://admin.example.test';
  const publicOrigin = 'https://api.example.test';
  const evil = 'https://evil.example.test';
  const keys = new Set<string>();
  const cookie = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const login = () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
  const badLogin = (username: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ username, password: 'incorrect' });
  function newKey() {
    const username = `boundary_${randomUUID()}`;
    const key = `auth:fail:user:${username}`;
    keys.add(key);
    return { username, key };
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      THROTTLE_STORAGE: 'memory',
      THROTTLE_LIMIT: '10000',
      THROTTLE_LOGIN_LIMIT: '1000',
      AUTH_FAIL_USER_MAX: '1',
      AUTH_FAIL_IP_MAX: '10000',
      AUTH_FAIL_WINDOW_SEC: '1',
      COOKIE_SECURE: 'true',
      COOKIE_SAME_SITE: 'none',
      CAPTCHA_REQUIRED: 'false',
      CAPTCHA_E2E_BYPASS: 'false',
      APP_PUBLIC_URL: `${publicOrigin}/prefix`,
      CORS_ORIGINS: trusted,
    });
    const fixture = await appFixture();
    app = fixture.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [trusted], credentials: true });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    userId = (await prisma.user.findUniqueOrThrow({ where: { username: 'vben' } })).id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (keys.size > 0) await redis.getClient().del(...keys);
    keys.clear();
  });
  afterAll(async () => app?.close());

  const routes = ['/api', '/api/v1'].flatMap((prefix) =>
    ['login', 'refresh', 'logout'].map((action) => `${prefix}/auth/${action}`),
  );
  it.each(routes)('rejects an untrusted origin before session mutation at %s', async (route) => {
    const session = await login();
    const before = await prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
    const response = await request(app.getHttpServer())
      .post(route)
      .set('Origin', evil)
      .set('Cookie', cookie(session))
      .type('form')
      .send({ username: 'vben', password: '123456' })
      .expect(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(
      await prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    const valid = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie(session))
      .set('Origin', trusted)
      .expect(200);
    expect(valid.text).not.toMatch(/^\{/); // Vben refresh still returns the bare access token.
  });
  it.each([
    'null',
    `${trusted}.evil.test`,
    `${trusted}/path`,
    `${trusted}, ${evil}`,
    `${trusted}/`,
  ])('rejects malformed or opaque Origin %s without clearing cookies', async (origin) => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Origin', origin)
      .expect(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it.each([trusted, publicOrigin])(
    'allows configured origin %s through login, refresh and logout',
    async (origin) => {
      const session = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('Sec-Fetch-Site', 'cross-site')
        .send({ username: 'vben', password: '123456' })
        .expect(200);
      expect(session.headers['set-cookie'][0]).toContain('SameSite=None');
      expect(session.headers['set-cookie'][0]).toContain('Secure');
      const refreshed = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', cookie(session))
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('Cookie', cookie(refreshed))
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Origin', origin)
        .set('Cookie', cookie(refreshed))
        .expect(403);
    },
  );
  it('preserves clients without Origin, but rejects cross-site Fetch Metadata without Origin', async () => {
    const session = await login();
    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', cookie(session))
      .expect(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie(session))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie(refreshed))
      .expect(200);
  });
  it('does not trust Host or forwarded headers as a source of allowed origins', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Origin', evil)
      .set('Host', 'evil.example.test')
      .set('X-Forwarded-Host', 'evil.example.test')
      .set('X-Forwarded-Proto', 'https')
      .expect(403);
  });

  it('counts concurrent failures without losing expiry or increments', async () => {
    const { key } = newKey();
    const counts = await Promise.all(
      Array.from({ length: 64 }, () => redis.incrWithTtlStrict(key, 30)),
    );
    expect(new Set(counts).size).toBe(64);
    expect(await redis.readCounterWithTtlStrict(key, 30)).toBe(64);
    expect(await redis.getClient().ttl(key)).toBeGreaterThan(0);
  });
  it('preserves the first expiry across increments and reads', async () => {
    const { key } = newKey();
    await redis.getClient().set(key, '5', 'PX', 1500);
    expect(await redis.incrWithTtlStrict(key, 30)).toBe(6);
    expect(await redis.readCounterWithTtlStrict(key, 30)).toBe(6);
    expect(await redis.getClient().pttl(key)).toBeGreaterThan(0);
    expect(await redis.getClient().pttl(key)).toBeLessThanOrEqual(1500);
  });
  it('repairs legacy permanent locks when reading a locked account and allows retry after expiry', async () => {
    const { key, username } = newKey();
    await redis.getClient().set(key, '5');
    await badLogin(username).expect(429);
    expect(await redis.getClient().pttl(key)).toBeGreaterThan(0);
    expect(await redis.getClient().pttl(key)).toBeLessThanOrEqual(1000);
    const deadline = Date.now() + 3000;
    while (await redis.getClient().exists(key)) {
      if (Date.now() > deadline) throw new Error('Failure counter did not expire');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await badLogin(username).expect(403);
    expect(await redis.getClient().get(key)).toBe('1');
    await badLogin(username).expect(429);
  });
  it('retains expiry if the Redis reply is lost after execution', async () => {
    const { key } = newKey();
    const client = redis.getClient();
    const evalCommand = client.eval.bind(client);
    jest
      .spyOn(client, 'eval')
      .mockImplementationOnce(async (...args: Parameters<typeof client.eval>) => {
        await evalCommand(...args);
        throw new Error('Injected reply loss after execution');
      });
    await expect(redis.incrWithTtlStrict(key, 30)).rejects.toThrow('reply loss');
    expect(await client.get(key)).toBe('1');
    expect(await client.ttl(key)).toBeGreaterThan(0);
    expect(await redis.incrWithTtlStrict(key, 30)).toBe(2);
  });
  it('creates an expiring key atomically and does not increment an orphan if EXPIRE is denied', async () => {
    const { key } = newKey();
    const username = `boundary_acl_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID();
    const client = redis.getClient();
    await client.acl(
      'SETUSER',
      username,
      'on',
      `>${password}`,
      '~auth:fail:user:boundary_*',
      '+@all',
      '-expire',
    );
    const url = new URL(process.env.REDIS_URL!);
    url.username = username;
    url.password = password;
    const limited = new RedisService(new ConfigService({ REDIS_URL: url.toString() }));
    try {
      await limited.onModuleInit();
      expect(await limited.incrWithTtlStrict(key, 30)).toBe(1);
      expect(await client.ttl(key)).toBeGreaterThan(0);
      await client.set(key, '5'); // A legacy key without expiry.
      await expect(limited.incrWithTtlStrict(key, 30)).rejects.toThrow();
      expect(await client.get(key)).toBe('5');
      expect(await client.ttl(key)).toBe(-1);
    } finally {
      await limited.onModuleDestroy();
      await client.acl('DELUSER', username);
    }
  });
  it.each(['NaN', '-1', '1.5', '', '9007199254740992'])(
    'fails closed for corrupted counter %j',
    async (raw) => {
      const { key, username } = newKey();
      await redis.getClient().set(key, raw);
      const response = await badLogin(username).expect(503);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await redis.getClient().get(key)).toBe(raw);
    },
  );
  it.each([0, -1, 1.5, 2_147_483_648])(
    'rejects invalid counter TTL %s before mutation',
    async (ttl) => {
      const { key } = newKey();
      await expect(redis.incrWithTtlStrict(key, ttl)).rejects.toThrow('TTL');
      expect(await redis.getClient().exists(key)).toBe(0);
    },
  );
});
