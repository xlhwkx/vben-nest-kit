import { BadRequestException, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ADMIN_ROUTES, provisionAdminRoutes } from '../src/common/authorization/admin-routes';
import request from 'supertest';
import type { AuthUser } from '../src/common/decorators/current-user.decorator';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { AuditService } from '../src/modules/audit/audit.service';
import { MenuService } from '../src/modules/menu/menu.service';
import { SystemMenuService } from '../src/modules/system/menu/system-menu.service';
import type { SystemMenuInput } from '../src/modules/system/menu/system-menu.service';
import { SystemRoleService } from '../src/modules/system/role/system-role.service';
import { SystemUserService } from '../src/modules/system/user/system-user.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { appFixture } from './app-fixture';

describe('menu semantics and management edit revisions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let actor: AuthUser;
  let token: string;
  const menus = new Set<string>();
  const roles = new Set<string>();
  const users = new Set<string>();
  const unique = () => `edit_${randomUUID().replaceAll('-', '')}`;

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
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'vben' },
    });
    actor = {
      userId: admin.id,
      username: admin.username,
      tokenVersion: admin.tokenVersion,
    };
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'vben', password: '123456' })
      .expect(200);
    token = (login.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
    await prisma.role.deleteMany({ where: { id: { in: [...roles] } } });
    await prisma.menu.deleteMany({ where: { id: { in: [...menus] } } });
    users.clear();
    roles.clear();
    menus.clear();
  });
  afterAll(async () => app?.close());

  it('provisions complete navigation only to the selected role, preserving existing definitions', async () => {
    const selected = await role();
    const unrelated = await role();
    const names = ['System', ...ADMIN_ROUTES.map((route) => route.name)];
    const before = await prisma.menu.findMany({
      where: { name: { in: names } },
      orderBy: { name: 'asc' },
    });
    expect(before).toHaveLength(7);
    await prisma.$transaction((tx) => provisionAdminRoutes(tx, selected.id));
    await prisma.$transaction((tx) => provisionAdminRoutes(tx, selected.id));
    expect(await prisma.roleMenu.count({ where: { roleId: selected.id } })).toBe(7);
    expect(await prisma.roleMenu.count({ where: { roleId: unrelated.id } })).toBe(0);
    expect(
      await prisma.menu.findMany({
        where: { name: { in: names } },
        orderBy: { name: 'asc' },
      }),
    ).toEqual(before);
    const userRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'user' },
    });
    expect(
      await prisma.roleMenu.count({
        where: { roleId: userRole.id, menu: { name: { in: names } } },
      }),
    ).toBe(0);
  });

  it('rejects conflicting navigation and rolls back partial role grants with the transaction', async () => {
    const selected = await role();
    const existing = await prisma.menu.findUniqueOrThrow({
      where: { name: 'SystemRole' },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.menu.update({
          where: { id: existing.id },
          data: { component: '/custom/keep' },
        });
        await provisionAdminRoutes(tx, selected.id);
      }),
    ).rejects.toThrow('conflicts with the admin route catalog');
    expect(await prisma.roleMenu.count({ where: { roleId: selected.id } })).toBe(0);
    expect(await prisma.menu.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing);
  });

  it('refuses custom menu path collisions instead of silently taking over an existing route', async () => {
    const selected = await role();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.menu.create({
          data: { name: unique(), path: '/system', type: 'catalog' },
        });
        await provisionAdminRoutes(tx, selected.id);
      }),
    ).rejects.toThrow('reserved admin path');
    expect(await prisma.roleMenu.count({ where: { roleId: selected.id } })).toBe(0);
  });

  const put = (resource: string, id: string, body: object) =>
    request(app.getHttpServer())
      .put(`/api/system/${resource}/${id}`)
      .auth(token, { type: 'bearer' })
      .send(body);
  const post = (resource: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/system/${resource}`)
      .auth(token, { type: 'bearer' })
      .send(body);

  async function menu(extra: Partial<SystemMenuInput> = {}) {
    const name = unique();
    const row = await app
      .get(SystemMenuService)
      .create({ name, path: `/${name}`, type: 'catalog', ...extra }, actor);
    menus.add(row.id);
    return row;
  }
  async function role(permissions: string[] = []) {
    const row = await app.get(SystemRoleService).create({ name: unique(), permissions }, actor);
    roles.add(row.id);
    return row;
  }
  async function user(roleIds: string[] = []) {
    const row = await prisma.user.create({
      data: {
        username: unique(),
        realName: 'Fixture',
        passwordHash: 'not-for-login',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    users.add(row.id);
    return prisma.user.findUniqueOrThrow({ where: { id: row.id } });
  }

  it('preserves omitted optional menu fields, including disabled status and sort order', async () => {
    const parent = await menu();
    const child = await menu({
      pid: parent.id,
      type: 'menu',
      status: 0,
      authCode: 'System:Dept:List',
      component: '/fixture',
      redirect: '/target',
      meta: { title: 'Before', icon: 'fixture', order: 42 },
    });
    await put('menu', child.id, {
      name: child.name,
      path: child.path,
      type: child.type,
      version: child.version,
    }).expect(200);
    const stored = await prisma.menu.findUniqueOrThrow({
      where: { id: child.id },
    });
    expect(stored).toMatchObject({
      parentId: parent.id,
      status: 0,
      authCode: 'System:Dept:List',
      component: '/fixture',
      redirect: '/target',
      sortOrder: 42,
      meta: { title: 'Before', icon: 'fixture', order: 42 },
    });
    expect(stored.version).toBeGreaterThan(child.version);
  });

  it('clears nullable menu fields explicitly and replaces rather than merges meta', async () => {
    const parent = await menu();
    const child = await menu({
      pid: parent.id,
      component: '/fixture',
      authCode: 'System:Dept:List',
      redirect: '/target',
      meta: { order: 42, icon: 'old' },
    });
    const res = await put('menu', child.id, {
      name: child.name,
      path: child.path,
      type: child.type,
      version: child.version,
      pid: null,
      component: null,
      authCode: null,
      redirect: null,
      meta: { title: 'Replacement' },
    }).expect(200);
    expect(await prisma.menu.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({
      parentId: null,
      component: null,
      authCode: null,
      redirect: null,
      meta: { title: 'Replacement' },
      sortOrder: 0,
    });
    await put('menu', child.id, {
      name: child.name,
      path: child.path,
      type: child.type,
      version: (res.body as { data: { version: number } }).data.version,
      meta: null,
    }).expect(200);
    expect((await prisma.menu.findUniqueOrThrow({ where: { id: child.id } })).meta).toEqual({});
  });

  it('rejects incomplete route grants but accepts explicit ancestors and independent buttons', async () => {
    const parent = await menu({ authCode: 'System:Dept:List' });
    const child = await menu({
      pid: parent.id,
      type: 'menu',
      component: '/fixture',
    });
    const name = unique();
    await post('role', { name, permissions: [child.id] }).expect(400);
    expect(await prisma.role.count({ where: { name } })).toBe(0);
    const allowed = await role([parent.id, child.id]);
    const member = await user([allowed.id]);
    const routes = await app.get(MenuService).getAllForUser(member.id);
    expect(routes).toEqual([
      expect.objectContaining({
        name: parent.name,
        children: [expect.objectContaining({ name: child.name })],
      }),
    ]);
    const button = await menu({
      pid: child.id,
      type: 'button',
      path: '',
      authCode: 'System:User:List',
    });
    const buttonRole = await role([button.id]);
    expect(buttonRole.permissions).toEqual([button.id]);
    const links = await prisma.roleMenu.findMany({
      where: { roleId: buttonRole.id },
    });
    expect(links.map((link) => link.menuId)).toEqual([button.id]);
  });

  it('rejects incomplete grants on role update without changing the revision or audit', async () => {
    const parent = await menu();
    const child = await menu({ pid: parent.id });
    const target = await role([parent.id, child.id]);
    const beforeAudit = await prisma.auditLog.count({
      where: { action: 'system.role.update' },
    });
    await put('role', target.id, {
      version: target.version,
      permissions: [child.id],
    }).expect(400);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: target.id } })).version).toBe(
      target.version,
    );
    expect(await prisma.auditLog.count({ where: { action: 'system.role.update' } })).toBe(
      beforeAudit,
    );
  });

  it('rolls back menu moves that break saved grants; succeeds after explicitly granting the new parent', async () => {
    const first = await menu();
    const second = await menu();
    const child = await menu({ pid: first.id });
    const target = await role([first.id, child.id]);
    const body = {
      name: child.name,
      path: child.path,
      type: child.type,
      version: child.version,
      pid: second.id,
    };
    await put('menu', child.id, body).expect(400);
    expect(await prisma.menu.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({
      parentId: first.id,
      version: child.version,
    });
    await put('role', target.id, {
      version: target.version,
      permissions: [first.id, second.id, child.id],
    }).expect(200);
    await put('menu', child.id, body).expect(200);
    expect((await prisma.menu.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(
      second.id,
    );
  });

  it('rejects buttons as route containers on creation and type changes', async () => {
    const button = await menu({ type: 'button', path: '' });
    await post('menu', {
      name: unique(),
      path: '/invalid',
      type: 'menu',
      pid: button.id,
    }).expect(400);
    const parent = await menu();
    await menu({ pid: parent.id });
    await put('menu', parent.id, {
      name: parent.name,
      path: '',
      type: 'button',
      version: parent.version,
    }).expect(400);
  });

  it('prevents a stale role form from restoring revoked permissions', async () => {
    const grant = await menu({
      type: 'button',
      path: '',
      authCode: 'System:User:List',
    });
    const target = await role([grant.id]);
    const revoked = await put('role', target.id, {
      version: target.version,
      permissions: [],
    }).expect(200);
    const beforeAudit = await prisma.auditLog.count({
      where: { action: 'system.role.update' },
    });
    const stale = await put('role', target.id, {
      version: target.version,
      name: 'stale',
      permissions: target.permissions,
    }).expect(409);
    expect((stale.body as { error: string }).error).toContain('刷新');
    expect(await prisma.roleMenu.count({ where: { roleId: target.id } })).toBe(0);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: target.id } })).name).toBe(
      target.name,
    );
    expect(await prisma.auditLog.count({ where: { action: 'system.role.update' } })).toBe(
      beforeAudit,
    );
    const next = (revoked.body as { data: { version: number } }).data.version;
    await put('role', target.id, { version: next, name: 'fresh' }).expect(200);
  });

  it('prevents a stale user form from restoring a removed role', async () => {
    const bound = await role();
    const member = await user([bound.id]);
    const revoked = await put('user', member.id, {
      version: member.version,
      roles: [],
    }).expect(200);
    await put('user', member.id, {
      version: member.version,
      name: 'stale',
      roles: [bound.id],
    }).expect(409);
    expect(await prisma.userRole.count({ where: { userId: member.id } })).toBe(0);
    const next = (revoked.body as { data: { version: number } }).data.version;
    await put('user', member.id, { version: next, name: 'fresh' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).tokenVersion).toBe(
      member.tokenVersion,
    );
  });

  it('rejects stale menu edits without restoring disabled status', async () => {
    const target = await menu();
    const body = {
      name: target.name,
      path: target.path,
      type: target.type,
      version: target.version,
    };
    const updated = await put('menu', target.id, { ...body, status: 0 }).expect(200);
    await put('menu', target.id, { ...body, status: 1 }).expect(409);
    const stored = await prisma.menu.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(stored.status).toBe(0);
    expect(stored.version).toBe((updated.body as { data: { version: number } }).data.version);
  });

  it.each(['role', 'user', 'menu'])(
    'allows exactly one of two concurrent edits of %s with the same revision',
    async (resource) => {
      const target =
        resource === 'role' ? await role() : resource === 'user' ? await user() : await menu();
      const menuFields = resource === 'menu' ? { path: '/concurrent', type: 'catalog' } : {};
      const names = [unique(), unique()];
      const responses = await Promise.all(
        names.map((name) =>
          put(resource, target.id, {
            ...menuFields,
            name,
            version: target.version,
          }),
        ),
      );
      expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
      const winner = responses.find((res) => res.status === 200)!;
      const listed =
        resource === 'menu'
          ? await prisma.menu.findUniqueOrThrow({ where: { id: target.id } })
          : resource === 'role'
            ? await prisma.role.findUniqueOrThrow({ where: { id: target.id } })
            : await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(listed.version).toBe((winner.body as { data: { version: number } }).data.version);
    },
  );

  it.each(['user', 'role', 'menu'])(
    'requires a valid edit version and editable fields for %s',
    async (resource) => {
      const id = randomUUID();
      const fields =
        resource === 'menu' ? { name: 'valid', path: '/valid', type: 'menu' } : { name: 'valid' };
      for (const version of [undefined, null, '1', 0, -1, 1.5, 2_147_483_648]) {
        await put(resource, id, { ...fields, version }).expect(400);
      }
      await put(resource, id, { version: 1 }).expect(400);
    },
  );

  it('rolls back revision claims with audit failures and rejects service calls missing a version', async () => {
    const target = await role();
    jest
      .spyOn(app.get(AuditService), 'recordInTransaction')
      .mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      app
        .get(SystemRoleService)
        .update(target.id, { name: 'aborted', version: target.version }, actor),
    ).rejects.toThrow('audit unavailable');
    expect((await prisma.role.findUniqueOrThrow({ where: { id: target.id } })).version).toBe(
      target.version,
    );
    await expect(
      app.get(SystemUserService).update(randomUUID(), { name: 'bad' } as never, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('invalidates aggregate versions on direct relation insert/update/delete and rolls back on abort', async () => {
    const first = await role();
    const second = await role();
    const member = await user();
    const other = await user();
    const grant = await menu({ type: 'button', path: '' });
    await prisma.roleMenu.create({
      data: { roleId: first.id, menuId: grant.id },
    });
    const afterInsert = await prisma.role.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(afterInsert.version).toBeGreaterThan(first.version);
    await prisma.roleMenu.update({
      where: { roleId_menuId: { roleId: first.id, menuId: grant.id } },
      data: { roleId: second.id },
    });
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: first.id } })).version,
    ).toBeGreaterThan(afterInsert.version);
    const secondBefore = await prisma.role.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(secondBefore.version).toBeGreaterThan(second.version);
    await prisma.roleMenu.deleteMany({ where: { roleId: second.id } });
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: second.id } })).version,
    ).toBeGreaterThan(secondBefore.version);

    await prisma.userRole.create({
      data: { userId: member.id, roleId: first.id },
    });
    const userAfter = await prisma.user.findUniqueOrThrow({
      where: { id: member.id },
    });
    expect(userAfter.version).toBeGreaterThan(member.version);
    await prisma.userRole.update({
      where: { userId_roleId: { userId: member.id, roleId: first.id } },
      data: { userId: other.id },
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).version,
    ).toBeGreaterThan(userAfter.version);
    const otherBefore = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(otherBefore.version).toBeGreaterThan(other.version);
    await prisma.userRole.deleteMany({ where: { userId: other.id } });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).version,
    ).toBeGreaterThan(otherBefore.version);

    const beforeAbort = await prisma.role.findUniqueOrThrow({
      where: { id: first.id },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.roleMenu.create({
          data: { roleId: first.id, menuId: grant.id },
        });
        expect(
          (await tx.role.findUniqueOrThrow({ where: { id: first.id } })).version,
        ).toBeGreaterThan(beforeAbort.version);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await prisma.role.findUniqueOrThrow({ where: { id: first.id } })).version).toBe(
      beforeAbort.version,
    );
  });
});
