import { VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { appFixture } from './app-fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('management input contract (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  const missingId = '00000000-0000-7000-8000-000000000001';

  beforeAll(async () => {
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.AUTH_FAIL_IP_MAX = '10000';
    process.env.CAPTCHA_REQUIRED = 'false';
    const fixture = await appFixture();
    app = fixture.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    token = (res.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => app?.close());

  it.each(['user', 'role', 'dict/type', 'dict/data', 'audit'])(
    'rejects malformed pagination and repeated/nested scalar filters: %s',
    async (resource) => {
      const extra = resource === 'dict/data' ? '&dictCode=user_gender' : '';
      const filters = [
        'page=1abc',
        'page=-1',
        'page=1.5',
        'page=1e2',
        'page=0',
        'page=9007199254740992',
        'page=1000001&pageSize=100',
        'pageSize=101',
        'page=1&page=2',
        'pageSize[gte]=20',
      ];
      const field = resource === 'audit' ? 'username' : resource === 'dict/data' ? 'label' : 'name';
      filters.push(`${field}=a&${field}=b`, `${field}[contains]=a`);
      for (const filter of filters) {
        const res = await request(app.getHttpServer())
          .get(`/api/system/${resource}/list?${filter}${extra}`)
          .auth(token, { type: 'bearer' })
          .expect(400);
        expect((res.body as { code: number; data: unknown }).code).toBe(-1);
        expect((res.body as { data: unknown }).data).toBeNull();
      }
    },
  );

  it.each(['user', 'role', 'menu', 'dept', 'dict/type', 'dict/data'])(
    'rejects invalid path UUID before issuing a mutation: %s',
    async (resource) => {
      await request(app.getHttpServer())
        .put(`/api/v1/system/${resource}/not-a-uuid`)
        .auth(token, { type: 'bearer' })
        .send({ status: 1 })
        .expect(400);
      await request(app.getHttpServer())
        .delete(`/api/system/${resource}/not-a-uuid`)
        .auth(token, { type: 'bearer' })
        .expect(400);
    },
  );

  it.each([
    '/system/user/list?id=not-a-uuid',
    '/system/user/list?deptId=not-a-uuid',
    '/system/user/list?gender=3',
    '/system/role/list?status=enabled',
    '/system/role/list?id=not-a-uuid',
    '/system/dict/type/list?status=2',
    '/system/dict/data/list?dictCode=user_gender&status=false',
    '/system/menu/name-exists?name=a&name=b',
    '/system/menu/path-exists?path=a&id=not-a-uuid',
    '/system/dict/type/code-exists?code=a&code=b',
    '/dict/data?code=a&code=b',
    '/dict/data?code[contains]=a',
  ])('rejects malformed filters and existence checks: %s', async (path) => {
    await request(app.getHttpServer())
      .get(`/api${path}`)
      .auth(token, { type: 'bearer' })
      .expect(400);
  });

  it.each(['user', 'role', 'audit'])(
    'rejects invalid and inverted calendar filters: %s',
    async (resource) => {
      for (const filter of [
        'startTime=2024-02-30',
        'endTime=tomorrow',
        'startTime=2024-01-01T00:00:00',
        'startTime=2024-02-01&endTime=2024-01-01',
      ]) {
        await request(app.getHttpServer())
          .get(`/api/system/${resource}/list?${filter}`)
          .auth(token, { type: 'bearer' })
          .expect(400);
      }
    },
  );

  it.each([
    ['user', { username: '  ', password: '123456', name: 'Valid' }],
    [
      'user',
      {
        username: 'invalid_roles',
        password: '123456',
        name: 'Valid',
        roles: ['invalid'],
      },
    ],
    [
      'user',
      {
        username: 'many_roles',
        password: '123456',
        name: 'Valid',
        roles: Array<string>(1001).fill(missingId),
      },
    ],
    ['role', { name: '  ' }],
    ['role', { name: 'Valid', permissions: ['invalid'] }],
    ['dept', { name: 'Valid', pid: 42 }],
    ['menu', { name: 'Valid', path: '', type: 'button', pid: 'invalid' }],
    ['menu', { name: 'Valid', path: '', type: 'button', meta: { order: 1.5 } }],
    [
      'menu',
      {
        name: 'Valid',
        path: '',
        type: 'button',
        meta: { order: 2_147_483_648 },
      },
    ],
    ['dict/data', { dictCode: 'user_gender', label: 'Valid', value: 1, sort: 1.5 }],
    [
      'dict/data',
      {
        dictCode: 'user_gender',
        label: 'Valid',
        value: 1,
        sort: -2_147_483_649,
      },
    ],
  ])('rejects invalid create body: %s', async (resource, body) => {
    await request(app.getHttpServer())
      .post(`/api/system/${resource}`)
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(400);
  });

  it.each(['user', 'role', 'dict/type', 'dict/data'])(
    'rejects empty or unknown-only updates: %s',
    async (resource) => {
      for (const body of [{}, { typo: 'ignored' }]) {
        await request(app.getHttpServer())
          .put(`/api/system/${resource}/${missingId}`)
          .auth(token, { type: 'bearer' })
          .send(body)
          .expect(400);
      }
    },
  );

  it('distinguishes a valid UUID for a missing record from malformed input', async () => {
    await request(app.getHttpServer())
      .delete(`/api/system/role/${missingId}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });

  it('preserves tree roots and normalizes required names', async () => {
    const name = `validation_${randomUUID().slice(0, 8)}`;
    const res = await request(app.getHttpServer())
      .post('/api/system/dept')
      .auth(token, { type: 'bearer' })
      .send({ name: `  ${name}  `, pid: 0 })
      .expect(200);
    const dept = (res.body as { data: { id: string; name: string; pid: number } }).data;
    try {
      expect(dept.name).toBe(name);
      expect(dept.pid).toBe(0);
    } finally {
      await request(app.getHttpServer())
        .delete(`/api/system/dept/${dept.id}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
    }
  });

  it('bounds login inputs before password verification', async () => {
    for (const body of [
      { username: 'a'.repeat(65), password: '123456' },
      { username: 'vben', password: 'a'.repeat(129) },
    ]) {
      await request(app.getHttpServer()).post('/api/auth/login').send(body).expect(400);
    }
  });

  it('preserves dictionary updates and explicitly rejects moving an item', async () => {
    const code = `validation_${randomUUID().slice(0, 8)}`;
    const typeRes = await request(app.getHttpServer())
      .post('/api/system/dict/type')
      .auth(token, { type: 'bearer' })
      .send({ name: code, code })
      .expect(200);
    const typeId = (typeRes.body as { data: { id: string } }).data.id;
    try {
      const itemRes = await request(app.getHttpServer())
        .post('/api/system/dict/data')
        .auth(token, { type: 'bearer' })
        .send({
          dictCode: code,
          label: '  Item  ',
          value: 0,
          sort: -2_147_483_648,
        })
        .expect(200);
      const item = (itemRes.body as { data: { id: string; label: string; value: number } }).data;
      expect(item.label).toBe('Item');
      expect(item.value).toBe(0);
      await request(app.getHttpServer())
        .put(`/api/system/dict/data/${item.id}`)
        .auth(token, { type: 'bearer' })
        .send({ dictCode: code, status: 0, sort: 2_147_483_647 })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/api/system/dict/data/${item.id}`)
        .auth(token, { type: 'bearer' })
        .send({ dictCode: 'user_gender' })
        .expect(400);
      const stored = await prisma.dictItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(stored.dictCode).toBe(code);
      expect(stored.status).toBe(0);
      expect(stored.sort).toBe(2_147_483_647);
    } finally {
      await request(app.getHttpServer())
        .delete(`/api/system/dict/type/${typeId}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
    }
  });

  it('uses the same Shanghai calendar boundaries for audit and other lists', async () => {
    const username = `calendar_${randomUUID().slice(0, 8)}`;
    const dates = [
      '2024-01-30T15:59:59.999Z',
      '2024-01-30T16:00:00.000Z',
      '2024-01-31T15:59:59.999Z',
      '2024-01-31T16:00:00.000Z',
    ];
    await prisma.auditLog.createMany({
      data: dates.map((date) => ({
        username,
        action: 'validation.calendar',
        createdAt: new Date(date),
      })),
    });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/system/audit/list')
        .query({
          username,
          startTime: '2024-01-31',
          endTime: '2024-01-31',
          pageSize: 100,
        })
        .auth(token, { type: 'bearer' })
        .expect(200);
      const data = (res.body as { data: { total: number; items: unknown[] } }).data;
      expect(data.total).toBe(2);
      expect(data.items).toHaveLength(2);
    } finally {
      await prisma.auditLog.deleteMany({
        where: { username, action: 'validation.calendar' },
      });
    }
  });
});
