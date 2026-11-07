import {
  VERSION_NEUTRAL,
  VersioningType,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { appFixture } from './app-fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Prisma } from '../src/generated/prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { SystemRoleService } from '../src/modules/system/role/system-role.service';
import { authorizationMutation } from '../src/common/authorization/authorization-mutation';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';

/** Runs against migrated PostgreSQL + Redis, including real row locks and rollback. */
describe('authorization and session regressions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let memberToken: string;
  let userId: string;
  let roleId: string;
  let menuId: string;
  const username = `regression_${randomUUID().slice(0, 8)}`;
  const password = 'regression-only-password';

  const cookie = (res: request.Response): string => {
    const values = res.headers['set-cookie'] as unknown as string[];
    return values.find((value) => value.startsWith('jwt='))!.split(';')[0];
  };
  const accessToken = (res: request.Response) =>
    (res.body as { data: { accessToken: string } }).data.accessToken;
  async function login() {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);
  }
  beforeAll(async () => {
    process.env.THROTTLE_STORAGE = 'memory';
    process.env.THROTTLE_LIMIT = '10000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000';
    process.env.AUTH_FAIL_IP_MAX = '10000';
    process.env.CAPTCHA_REQUIRED = 'false';
    const fixture = await appFixture();
    app = fixture.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const role = await prisma.role.create({
      data: { code: username, name: username },
    });
    roleId = role.id;
    const user = await prisma.user.create({
      data: {
        username,
        realName: username,
        passwordHash: await argon2.hash(password),
        roles: { create: { roleId } },
      },
    });
    userId = user.id;
    const menu = await prisma.menu.findFirstOrThrow({
      where: { authCode: 'System:User:List', deletedAt: null, status: 1 },
    });
    menuId = menu.id;
    const admin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    adminToken = accessToken(admin);
    memberToken = accessToken(await login());
  }, 30_000);
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (roleId) await prisma.role.delete({ where: { id: roleId } });
    await app?.close();
  });

  const roleVersion = async () =>
    (await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).version;

  it('enforces a management read permission, immediately applies grants and revocations', async () => {
    const list = () =>
      request(app.getHttpServer())
        .get('/api/system/user/list')
        .auth(memberToken, { type: 'bearer' });
    await list().expect(403);
    const update = async (permissions: string[]) =>
      request(app.getHttpServer())
        .put(`/api/system/role/${roleId}`)
        .auth(adminToken, { type: 'bearer' })
        .send({ permissions, version: await roleVersion() })
        .expect(200);
    await update([menuId]);
    await list().expect(200);
    const codes = await request(app.getHttpServer())
      .get('/api/auth/codes')
      .auth(memberToken, { type: 'bearer' })
      .expect(200);
    expect((codes.body as { data: string[] }).data).toContain('System:User:List');
    await update([]);
    await list().expect(403);
  });
  it('excludes disabled roles from effective permission codes', async () => {
    await prisma.roleMenu.create({ data: { roleId, menuId } });
    await prisma.role.update({ where: { id: roleId }, data: { status: 0 } });
    await request(app.getHttpServer())
      .get('/api/system/user/list')
      .auth(memberToken, { type: 'bearer' })
      .expect(403);
    await prisma.role.update({ where: { id: roleId }, data: { status: 1 } });
    await prisma.roleMenu.deleteMany({ where: { roleId } });
  });
  it('allows exactly one refresh when the same cookie is used concurrently', async () => {
    const current = cookie(await login());
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', current),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 403]);
    expect(results.find((res) => res.status === 403)!.headers['set-cookie']).toBeUndefined();
    const active = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    expect(active).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie(results.find((res) => res.status === 200)!))
      .expect(200);
  });
  it('blocks delegated administrators from assigning roles, granting new powers or resetting higher accounts', async () => {
    const grants = await prisma.menu.findMany({
      where: {
        deletedAt: null,
        status: 1,
        authCode: {
          in: [
            'System:User:Create',
            'System:User:Update',
            'System:Role:Update',
            'System:Menu:Update',
          ],
        },
      },
    });
    await prisma.roleMenu.createMany({
      data: grants.map((menu) => ({ roleId, menuId: menu.id })),
    });
    try {
      await request(app.getHttpServer())
        .post('/api/system/user')
        .auth(memberToken, { type: 'bearer' })
        .send({
          username: `${username}_blocked`,
          name: 'blocked',
          password,
          roles: [roleId],
        })
        .expect(403);
      const deletePermission = await prisma.menu.findFirstOrThrow({
        where: { authCode: 'System:User:Delete', status: 1, deletedAt: null },
      });
      await request(app.getHttpServer())
        .put(`/api/system/role/${roleId}`)
        .auth(memberToken, { type: 'bearer' })
        .send({
          permissions: [deletePermission.id],
          version: await roleVersion(),
        })
        .expect(403);
      const ownMenu = grants.find((menu) => menu.authCode === 'System:User:Create')!;
      await request(app.getHttpServer())
        .put(`/api/system/menu/${ownMenu.id}`)
        .auth(memberToken, { type: 'bearer' })
        .send({
          name: ownMenu.name,
          path: '',
          type: 'button',
          authCode: 'System:User:Delete',
          version: ownMenu.version,
        })
        .expect(403);
      const administrator = await prisma.user.findUniqueOrThrow({
        where: { username: 'vben' },
      });
      await request(app.getHttpServer())
        .put(`/api/system/user/${administrator.id}`)
        .auth(memberToken, { type: 'bearer' })
        .send({
          password: 'attempted-takeover',
          version: administrator.version,
        })
        .expect(403);
    } finally {
      await prisma.roleMenu.deleteMany({ where: { roleId } });
    }
  });
  it('revokes the replacement session when logout races with rotation', async () => {
    const current = cookie(await login());
    const [rotation, logout] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', current),
      request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', current),
    ]);
    expect(logout.status).toBe(200);
    expect([200, 403]).toContain(rotation.status);
    if (rotation.status === 200)
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie(rotation))
        .expect(403);
  });
  it('rechecks authority when a queued mutation resumes after revocation', async () => {
    const updateCode = await prisma.menu.findFirstOrThrow({
      where: { authCode: 'System:Role:Update', status: 1, deletedAt: null },
    });
    await prisma.roleMenu.create({ data: { roleId, menuId: updateCode.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
        await tx.roleMenu.deleteMany({
          where: { roleId, menuId: updateCode.id },
        });
        entered();
        await gate;
      },
      { timeout: 15_000 },
    );
    await held;
    const mutation = app
      .get(SystemRoleService)
      .update(
        roleId,
        { name: 'must-not-commit', version: await roleVersion() },
        { userId, username, tokenVersion: user.tokenVersion },
      )
      .catch((error: unknown) => error);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const rows = await prisma.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory') AS waiting`;
        if (rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await blocker;
    }
    expect(await mutation).toBeInstanceOf(ForbiddenException);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).name).toBe(username);
  });
  it('rolls back a role mutation if its audit cannot be persisted', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: 'vben' },
    });
    const audit = jest
      .spyOn(app.get(AuditService), 'recordInTransaction')
      .mockRejectedValueOnce(new Error('simulated audit failure'));
    try {
      await expect(
        app.get(SystemRoleService).update(
          roleId,
          { name: 'must-not-commit', version: await roleVersion() },
          {
            userId: user.id,
            username: user.username,
            tokenVersion: user.tokenVersion,
          },
        ),
      ).rejects.toThrow('simulated audit failure');
      expect((await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).name).toBe(username);
    } finally {
      audit.mockRestore();
    }
  });
  it('bounds an authorization lock wait and reports retryable unavailability', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'vben' },
    });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
        entered();
        await gate;
      },
      { timeout: 15_000 },
    );
    await held;
    try {
      await expect(
        app.get(SystemRoleService).update(
          roleId,
          { name: 'must-not-commit', version: await roleVersion() },
          {
            userId: admin.id,
            username: admin.username,
            tokenVersion: admin.tokenVersion,
          },
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      release();
      await blocker;
    }
    expect((await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).name).toBe(username);
  }, 15_000);
  it('rejects losing all active administrators (the experiment always rolls back)', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'vben' },
    });
    // The outer transaction always aborts, even if the protection were to regress.
    const rollbackOnly = {
      $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        prisma.$transaction(async (tx) => {
          await run(tx);
          throw new Error('Administrator protection did not reject');
        }),
    };
    await expect(
      authorizationMutation(
        rollbackOnly as never,
        {
          userId: admin.id,
          username: admin.username,
          tokenVersion: admin.tokenVersion,
        },
        'System:User:Update',
        async (tx) => {
          await tx.user.updateMany({
            where: { status: 1, deletedAt: null },
            data: { status: 0 },
          });
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).status).toBe(1);
  });
  it('password reset invalidates concurrent refresh tokens and access tokens', async () => {
    const loggedIn = await login();
    const current = cookie(loggedIn);
    const [rotation, reset] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', current),
      request(app.getHttpServer())
        .put(`/api/system/user/${userId}`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          password,
          version: (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).version,
        }),
    ]);
    expect(reset.status).toBe(200);
    expect([200, 403]).toContain(rotation.status);
    if (rotation.status === 200) {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie(rotation))
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/auth/codes')
        .auth(rotation.text, { type: 'bearer' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .get('/api/auth/codes')
      .auth(accessToken(loggedIn), { type: 'bearer' })
      .expect(401);
  });
});
