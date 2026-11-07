import { VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { appFixture } from './app-fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { maintainData } from '../src/maintenance/data-retention';
import { AuditService } from '../src/modules/audit/audit.service';
import { STORAGE_PROVIDER } from '../src/modules/upload/storage/storage.types';
import type { StorageProvider } from '../src/modules/upload/storage/storage.types';
import { UploadCapacityInterceptor } from '../src/modules/upload/upload-capacity.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

describe('upload capacity and bounded retention (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  const sessions = new Set<string>();
  const auditIds = new Set<string>();
  const before = new Date('2001-01-01T00:00:00Z');
  const expired = new Date('2000-01-01T00:00:00Z');
  const future = new Date(Date.now() + 86_400_000);
  const options = {
    target: 'sessions' as const,
    before,
    apply: false,
    batchSize: 2,
    maxBatches: 1,
  };
  const put = jest
    .fn<ReturnType<StorageProvider['put']>, Parameters<StorageProvider['put']>>()
    .mockResolvedValue({ url: 'https://fixture.example/file.txt' });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  async function waitUntil(predicate: () => boolean) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Concurrency checkpoint timed out');
      await tick();
    }
  }
  const upload = () =>
    request(app.getHttpServer()).post('/api/upload').auth(token, { type: 'bearer' });

  beforeAll(async () => {
    Object.assign(process.env, {
      THROTTLE_STORAGE: 'memory',
      THROTTLE_LIMIT: '10000',
      THROTTLE_LOGIN_LIMIT: '1000',
      AUTH_FAIL_IP_MAX: '10000',
      CAPTCHA_REQUIRED: 'false',
      CAPTCHA_E2E_BYPASS: 'false',
      UPLOAD_MAX_BYTES: '1024',
      UPLOAD_MAX_CONCURRENT: '2',
    });
    const fixture = await appFixture();
    // Override after compilation so the actual parser and controller still run.
    const storage = fixture.get<StorageProvider>(STORAGE_PROVIDER);
    jest.spyOn(storage, 'put').mockImplementation(put);
    app = fixture.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    userId = (await prisma.user.findUniqueOrThrow({ where: { username: 'vben' } })).id;
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    token = (response.body as { data: { accessToken: string } }).data.accessToken;
  });
  afterEach(async () => {
    put.mockReset().mockResolvedValue({ url: 'https://fixture.example/file.txt' });
    await prisma.refreshToken.deleteMany({
      where: { id: { in: [...sessions] } },
    });
    await prisma.auditLog.deleteMany({ where: { id: { in: [...auditIds] } } });
    sessions.clear();
    auditIds.clear();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.get(AuditService).flush(2000);
    await app.close();
  });

  it('accepts a single file at the exact file limit and rejects larger content before storage', async () => {
    await upload()
      .attach('file', Buffer.alloc(1024, 'a'), {
        filename: 'ok.txt',
        contentType: 'text/plain',
      })
      .expect(200);
    await upload()
      .attach('file', Buffer.alloc(1025, 'a'), {
        filename: 'large.txt',
        contentType: 'text/plain',
      })
      .expect(413);
    expect(put).toHaveBeenCalledTimes(1);
  });
  it('rejects six MiB of ignored fields and never invokes storage', async () => {
    let pending = upload();
    for (let n = 0; n < 12; n++) pending = pending.field(`ignored${n}`, 'x'.repeat(512 * 1024));
    await pending
      .attach('file', Buffer.from('small'), {
        filename: 'ok.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects even one extra field, a second file, wrong field name and empty body', async () => {
    await upload()
      .field('metadata', 'unused')
      .attach('file', Buffer.from('small'), 'ok.txt')
      .expect(400);
    await upload()
      .attach('file', Buffer.from('one'), '1.txt')
      .attach('file', Buffer.from('two'), '2.txt')
      .expect(400);
    await upload().attach('wrong', Buffer.from('one'), '1.txt').expect(400);
    await upload().expect(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects excess concurrent uploads, then recovers after storage finishes', async () => {
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    put.mockImplementation(async () => {
      entered++;
      await gate;
      return { url: '/file' };
    });
    const first = upload()
      .attach('file', Buffer.from('one'), '1.txt')
      .then((res) => res.status);
    const second = upload()
      .attach('file', Buffer.from('two'), '2.txt')
      .then((res) => res.status);
    try {
      await waitUntil(() => entered === 2);
      await upload().attach('file', Buffer.from('third'), '3.txt').expect(503);
      expect(entered).toBe(2);
    } finally {
      release();
    }
    expect(await Promise.all([first, second])).toEqual([200, 200]);
    await upload().attach('file', Buffer.from('retry'), 'retry.txt').expect(200);
  });
  it('releases a capacity slot after a partial multipart client abort', async () => {
    const interceptor = app.get(UploadCapacityInterceptor);
    const spy = jest.spyOn(interceptor, 'intercept');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const partial = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/upload',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data; boundary=probe',
        'Transfer-Encoding': 'chunked',
      },
    });
    partial.on('error', () => undefined);
    partial.write(
      '--probe\r\nContent-Disposition: form-data; name="file"; filename="partial.txt"\r\nContent-Type: text/plain\r\n\r\na',
    );
    try {
      await waitUntil(() => spy.mock.calls.length > 0);
    } finally {
      partial.destroy();
      spy.mockRestore();
    }
    // Allow the parser's abort cleanup to settle, then prove both slots can run.
    await tick();
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    put.mockImplementation(async () => {
      entered++;
      await gate;
      return { url: '/file' };
    });
    const requests = [1, 2].map((n) =>
      upload()
        .attach('file', Buffer.from('retry'), `${n}.txt`)
        .then((res) => res.status),
    );
    try {
      await waitUntil(() => entered === 2);
    } finally {
      release();
    }
    expect(await Promise.all(requests)).toEqual([200, 200]);
  });

  async function session(
    expiresAt: Date,
    revokedAt: Date | null = null,
    familyId: string = randomUUID(),
  ) {
    const row = await prisma.refreshToken.create({
      data: {
        userId,
        expiresAt,
        revokedAt,
        familyId,
        jti: randomUUID(),
        tokenHash: 'fixture',
        tokenVersion: 0,
      },
    });
    sessions.add(row.id);
    return row;
  }
  async function oldAudit(createdAt = expired) {
    const row = await prisma.auditLog.create({
      data: { action: 'retention.fixture', createdAt },
    });
    auditIds.add(row.id);
    return row;
  }
  it('previews without deleting, then respects batch and cutoff limits', async () => {
    for (let n = 0; n < 5; n++) await session(expired);
    const boundary = await session(before);
    const preview = await maintainData(prisma, options);
    expect(preview).toMatchObject({
      eligibleAtStart: 5,
      deleted: 0,
      apply: false,
    });
    expect(await prisma.refreshToken.count({ where: { id: { in: [...sessions] } } })).toBe(6);
    const applied = await maintainData(prisma, { ...options, apply: true });
    expect(applied).toMatchObject({
      deleted: 2,
      batches: 1,
      maxRowsThisRun: 2,
    });
    expect(await prisma.refreshToken.findUnique({ where: { id: boundary.id } })).not.toBeNull();
    expect((await maintainData(prisma, { ...options, apply: true, maxBatches: 4 })).deleted).toBe(
      3,
    );
    expect((await maintainData(prisma, { ...options, apply: true })).deleted).toBe(0);
  });
  it('preserves unexpired revoked ancestors and active descendants in the same family', async () => {
    const parent = await session(future, new Date());
    const child = await session(future, null, parent.familyId);
    await session(expired, new Date(), parent.familyId);
    await maintainData(prisma, { ...options, apply: true });
    expect(
      await prisma.refreshToken.count({
        where: { id: { in: [parent.id, child.id] } },
      }),
    ).toBe(2);
  });
  it('requires selecting audit explicitly and leaves recent audits alone', async () => {
    const a = await oldAudit();
    const b = await oldAudit();
    const recent = await oldAudit(new Date());
    expect((await maintainData(prisma, { ...options, apply: true })).deleted).toBe(0);
    expect((await maintainData(prisma, { ...options, target: 'audit' })).eligibleAtStart).toBe(2);
    expect((await maintainData(prisma, { ...options, target: 'audit', apply: true })).deleted).toBe(
      2,
    );
    expect(
      await prisma.auditLog.count({
        where: { id: { in: [a.id, b.id, recent.id] } },
      }),
    ).toBe(1);
  });
  it('can run concurrent cleanup without exceeding either batch budget or touching live sessions', async () => {
    for (let n = 0; n < 6; n++) await session(expired);
    const live = await session(future);
    const results = await Promise.all(
      [1, 2].map(() => maintainData(prisma, { ...options, apply: true })),
    );
    expect(results.every((result) => result.deleted <= 2)).toBe(true);
    expect(results.reduce((n, result) => n + result.deleted, 0)).toBe(4);
    expect(await prisma.refreshToken.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
  it('cancels long SQL on PostgreSQL and reuses the connection afterwards', async () => {
    const limited = new PrismaService(
      new ConfigService({
        DATABASE_URL: process.env.DATABASE_URL,
        DATABASE_POOL_MAX: 2,
        DATABASE_CONNECT_TIMEOUT_MS: 1000,
        DATABASE_STATEMENT_TIMEOUT_MS: 100,
      }),
    );
    try {
      await limited.onModuleInit();
      await expect(limited.$queryRaw`SELECT 1 AS value FROM pg_sleep(0.5)`).rejects.toThrow(
        /statement timeout/i,
      );
      expect(await limited.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1 }]);
    } finally {
      await limited.onModuleDestroy();
    }
  });
});
