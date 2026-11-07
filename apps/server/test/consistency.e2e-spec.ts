import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { appFixture } from './app-fixture';
import type { AuthUser } from '../src/common/decorators/current-user.decorator';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { AuditService } from '../src/modules/audit/audit.service';
import type { AuditRecordInput } from '../src/modules/audit/audit.service';
import { CaptchaService } from '../src/modules/auth/captcha/captcha.service';
import { SystemDeptService } from '../src/modules/system/dept/system-dept.service';
import { SystemDictService } from '../src/modules/system/dict/system-dict.service';
import { SystemUserService } from '../src/modules/system/user/system-user.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Concurrency checkpoint was not reached')), 2000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('management concurrency and dependency recovery (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let depts: SystemDeptService;
  let dicts: SystemDictService;
  let actor: AuthUser;
  let token: string;
  const departments = new Set<string>();
  const dictionaryTypes = new Set<string>();
  const users = new Set<string>();
  const roles = new Set<string>();

  beforeAll(async () => {
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.AUTH_FAIL_IP_MAX = '10000';
    process.env.CAPTCHA_REQUIRED = 'false';
    process.env.CAPTCHA_E2E_BYPASS = 'false';
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
    redis = app.get(RedisService);
    depts = app.get(SystemDeptService);
    dicts = app.get(SystemDictService);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'vben' },
    });
    actor = {
      userId: admin.id,
      username: admin.username,
      tokenVersion: admin.tokenVersion,
    };
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    token = (res.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    process.env.CAPTCHA_REQUIRED = 'false';
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
    await prisma.role.deleteMany({ where: { id: { in: [...roles] } } });
    await prisma.dept.updateMany({
      where: { id: { in: [...departments] } },
      data: { parentId: null },
    });
    await prisma.dept.deleteMany({ where: { id: { in: [...departments] } } });
    await prisma.dictType.deleteMany({
      where: { id: { in: [...dictionaryTypes] } },
    });
    users.clear();
    roles.clear();
    departments.clear();
    dictionaryTypes.clear();
  });
  afterAll(async () => app?.close());

  async function dept() {
    const row = await prisma.dept.create({
      data: { name: `concurrent_${randomUUID()}` },
    });
    departments.add(row.id);
    return row;
  }
  async function dictionary(status = 1, code = `concurrent_${randomUUID()}`) {
    const row = await prisma.dictType.create({
      data: { name: code, code, status },
    });
    dictionaryTypes.add(row.id);
    return row;
  }
  async function user() {
    const row = await prisma.user.create({
      data: {
        username: `concurrent_${randomUUID()}`,
        realName: 'Fixture',
        passwordHash: 'never-used-for-login',
      },
    });
    users.add(row.id);
    return row;
  }
  function pauseAudit(predicate: (input: AuditRecordInput) => boolean) {
    const entered = deferred();
    const release = deferred();
    const audit = app.get(AuditService);
    const original = audit.recordInTransaction.bind(audit);
    let paused = false;
    jest.spyOn(audit, 'recordInTransaction').mockImplementation(async (tx, input) => {
      await original(tx, input);
      if (!paused && predicate(input)) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
    });
    return { entered: entered.promise, release: release.resolve };
  }
  async function waitForWriter() {
    for (let attempt = 0; attempt < 75; attempt++) {
      const rows = await prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory') AS waiting`;
      if (rows[0].waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The competing management writer did not wait for the lock');
  }
  const outcome = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  it('prevents opposite department moves from committing a cycle', async () => {
    const a = await dept();
    const b = await dept();
    const pause = pauseAudit(
      (input) => input.action === 'system.dept.update' && input.detail?.id === a.id,
    );
    const first = outcome(depts.update(a.id, { name: a.name, pid: b.id }, actor));
    let second: Promise<unknown> | undefined;
    try {
      await bounded(pause.entered);
      second = outcome(depts.update(b.id, { name: b.name, pid: a.id }, actor));
      await waitForWriter();
    } finally {
      pause.release();
      await first;
    }
    expect(await second).toBeInstanceOf(BadRequestException);
    expect((await prisma.dept.findUniqueOrThrow({ where: { id: a.id } })).parentId).toBe(b.id);
    expect((await prisma.dept.findUniqueOrThrow({ where: { id: b.id } })).parentId).toBeNull();
  });

  it.each([true, false])(
    'keeps department deletion and user assignment consistent (delete first: %s)',
    async (deleteFirst) => {
      const target = await dept();
      const member = await user();
      const assign = () =>
        app
          .get(SystemUserService)
          .update(member.id, { deptId: target.id, version: member.version }, actor);
      const remove = () => depts.remove(target.id, actor);
      const pause = pauseAudit((input) =>
        deleteFirst
          ? input.action === 'system.dept.delete' && input.detail?.id === target.id
          : input.action === 'system.user.update' && input.detail?.id === member.id,
      );
      const first = outcome(deleteFirst ? remove() : assign());
      let second: Promise<unknown> | undefined;
      try {
        await bounded(pause.entered);
        second = outcome(deleteFirst ? assign() : remove());
        await waitForWriter();
      } finally {
        pause.release();
        await first;
      }
      expect(await second).toBeInstanceOf(deleteFirst ? BadRequestException : ConflictException);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: member.id },
        include: { dept: true },
      });
      if (deleteFirst) expect(stored.deptId).toBeNull();
      else {
        expect(stored.deptId).toBe(target.id);
        expect(stored.dept?.deletedAt).toBeNull();
      }
    },
  );

  it.each(['Dept', 'Dict'])('rechecks a queued %s writer after revocation', async (resource) => {
    const member = await user();
    const role = await prisma.role.create({
      data: { code: member.username, name: member.username },
    });
    roles.add(role.id);
    await prisma.userRole.create({
      data: { userId: member.id, roleId: role.id },
    });
    const menu = await prisma.menu.findFirstOrThrow({
      where: {
        authCode: `System:${resource}:Create`,
        deletedAt: null,
        status: 1,
      },
    });
    await prisma.roleMenu.create({
      data: { roleId: role.id, menuId: menu.id },
    });
    const entered = deferred();
    const release = deferred();
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
        await tx.roleMenu.deleteMany({
          where: { roleId: role.id, menuId: menu.id },
        });
        entered.resolve();
        await release.promise;
      },
      { timeout: 10_000 },
    );
    const principal = {
      userId: member.id,
      username: member.username,
      tokenVersion: member.tokenVersion,
    };
    let mutation: Promise<unknown> | undefined;
    try {
      await bounded(entered.promise);
      mutation = outcome(
        resource === 'Dept'
          ? depts.create({ name: member.username }, principal)
          : dicts.createType({ name: member.username, code: member.username }, principal),
      );
      await waitForWriter();
    } finally {
      release.resolve();
      await blocker;
    }
    expect(await mutation).toBeInstanceOf(ForbiddenException);
    expect(await prisma.dept.count({ where: { name: member.username } })).toBe(0);
    expect(await prisma.dictType.count({ where: { code: member.username } })).toBe(0);
  });

  it.each(['Dept', 'Dict'])(
    'rolls back a %s write and its revision when audit persistence fails',
    async (resource) => {
      const name = `rollback_${randomUUID()}`;
      const before = await dicts.getVersion();
      jest
        .spyOn(app.get(AuditService), 'recordInTransaction')
        .mockRejectedValueOnce(new Error('audit unavailable'));
      await expect(
        resource === 'Dept'
          ? depts.create({ name }, actor)
          : dicts.createType({ name, code: name }, actor),
      ).rejects.toThrow('audit unavailable');
      expect(await prisma.dept.count({ where: { name } })).toBe(0);
      expect(await prisma.dictType.count({ where: { code: name } })).toBe(0);
      expect(await dicts.getVersion()).toBe(before);
    },
  );

  it('excludes disabled dictionary types from single and bulk pulls', async () => {
    const type = await dictionary(0);
    await prisma.dictItem.create({
      data: { dictCode: type.code, label: 'Hidden', value: 1 },
    });
    const res = await request(app.getHttpServer())
      .get('/api/dict/data')
      .query({ code: type.code })
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((res.body as { data: unknown[] }).data).toEqual([]);
    expect(Object.hasOwn(await dicts.getAllEnabled(), type.code)).toBe(false);
    await dicts.updateType(type.id, { status: 1 }, actor);
    expect(await dicts.getEnabledByCode(type.code)).toEqual([{ label: 'Hidden', value: 1 }]);
  });

  it('preserves dictionary codes which are also JavaScript prototype property names', async () => {
    const type = await dictionary(1, '__proto__');
    await prisma.dictItem.create({
      data: { dictCode: type.code, label: 'Own property', value: 1 },
    });
    const res = await request(app.getHttpServer())
      .get('/api/dict/all')
      .auth(token, { type: 'bearer' })
      .expect(200);
    const all = (res.body as { data: Record<string, unknown> }).data;
    expect(Object.hasOwn(all, '__proto__')).toBe(true);
    expect(all['__proto__']).toEqual([{ label: 'Own property', value: 1 }]);
  });

  it('publishes durable dictionary revisions while Redis is disconnected and after reconnect', async () => {
    const type = await dictionary();
    const before = await dicts.getVersion();
    const client = redis.getClient();
    client.disconnect();
    let changed: number;
    try {
      await dicts.updateType(type.id, { name: 'Written without Redis' }, actor);
      changed = await dicts.getVersion();
      expect(changed).toBeGreaterThan(before);
    } finally {
      await client.connect();
    }
    expect(await dicts.getVersion()).toBe(changed!);
  });

  it('bumps revisions for direct dictionary writes and FK cascades, and rolls them back on abort', async () => {
    const type = await dictionary();
    const item = await prisma.dictItem.create({
      data: { dictCode: type.code, label: 'Original', value: 1 },
    });
    const before = await dicts.getVersion();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.dictItem.update({
          where: { id: item.id },
          data: { label: 'Aborted' },
        });
        const state = await tx.dictionaryRevision.findUniqueOrThrow({
          where: { id: 1 },
        });
        expect(Number(state.version)).toBeGreaterThan(before);
        throw new Error('abort fixture');
      }),
    ).rejects.toThrow('abort fixture');
    expect(await dicts.getVersion()).toBe(before);
    expect((await prisma.dictItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe(
      'Original',
    );
    const renamed = `renamed_${randomUUID()}`;
    await prisma.dictType.update({
      where: { id: type.id },
      data: { code: renamed },
    });
    expect((await prisma.dictItem.findUniqueOrThrow({ where: { id: item.id } })).dictCode).toBe(
      renamed,
    );
    expect(await dicts.getVersion()).toBeGreaterThan(before);
  });

  it('allows exactly one concurrent login to consume a captcha ticket', async () => {
    process.env.CAPTCHA_REQUIRED = 'true';
    const challenge = await app.get(CaptchaService).issueChallenge();
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer()).post('/api/auth/login').send({
          username: 'vben',
          password: '123456',
          captchaId: challenge.captchaId,
          captchaToken: challenge.captchaToken,
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it('reports captcha storage failure as 503 and resumes consumption after Redis recovers', async () => {
    process.env.CAPTCHA_REQUIRED = 'true';
    const captcha = app.get(CaptchaService);
    const challenge = await captcha.issueChallenge();
    const client = redis.getClient();
    client.disconnect();
    try {
      await expect(captcha.issueChallenge()).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(captcha.assertLoginCaptcha(challenge)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    } finally {
      await client.connect();
    }
    await expect(captcha.assertLoginCaptcha(challenge)).resolves.toBeUndefined();
    await expect(captcha.assertLoginCaptcha(challenge)).rejects.toBeInstanceOf(BadRequestException);
  });
});
