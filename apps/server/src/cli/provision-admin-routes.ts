import { PrismaPg } from '@prisma/adapter-pg';
import { ADMIN_ROUTES, provisionAdminRoutes } from '../common/authorization/admin-routes';
import {
  readPermissionCodes,
  SYSTEM_PERMISSION_CODES,
} from '../common/authorization/permission-codes';
import { PrismaClient } from '../generated/prisma/client';

/** Explicit upgrade for an existing administrator, without demo seeding. */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const username = process.env.ADMIN_ROUTES_USERNAME?.trim();
  if (!databaseUrl || !username) throw new Error('Require DATABASE_URL and ADMIN_ROUTES_USERNAME');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
        const user = await tx.user.findFirst({
          where: { username, status: 1, deletedAt: null },
        });
        if (!user) throw new Error('Active administrator not found');
        const held = new Set(await readPermissionCodes(tx, user.id));
        if (!SYSTEM_PERMISSION_CODES.every((code) => held.has(code))) {
          throw new Error(
            'This command requires an existing administrator holding all system permissions',
          );
        }
        // Grant routes only to a new role dedicated to this named user. Never grant
        // pages or codes to other users sharing one of their existing roles.
        const roleCode = `admin-routes-${user.id}`;
        const role = await tx.role.upsert({
          where: { code: roleCode },
          update: {},
          create: {
            code: roleCode,
            name: 'Qingzhan management navigation',
          },
        });
        if (role.status !== 1) throw new Error('Navigation role is disabled; review it manually');
        const otherUsers = await tx.userRole.count({
          where: { roleId: role.id, userId: { not: user.id } },
        });
        if (otherUsers !== 0) throw new Error('Navigation role is shared; review it manually');
        const extraGrants = await tx.roleMenu.count({
          where: {
            roleId: role.id,
            menu: {
              name: {
                notIn: ['System', ...ADMIN_ROUTES.map((route) => route.name)],
              },
            },
          },
        });
        const extraPermissions = await tx.rolePermission.count({
          where: { roleId: role.id },
        });
        if (extraGrants || extraPermissions)
          throw new Error('Navigation role has unrelated grants; review it manually');
        await provisionAdminRoutes(tx, role.id);
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: role.id } },
          update: {},
          create: { userId: user.id, roleId: role.id },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { homePath: '/system/user' },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            username: user.username,
            action: 'system.routes.provision',
            module: 'system.menu',
            status: 200,
            detail: { roleId: role.id },
          },
        });
      },
      { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 20_000 },
    );
    console.log(
      'Management routes provisioned for the selected administrator; no demo accounts created',
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Admin route provisioning failed');
  process.exitCode = 1;
});
