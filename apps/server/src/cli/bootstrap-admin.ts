import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { SYSTEM_PERMISSION_CODES } from '../common/authorization/permission-codes';
import { provisionAdminRoutes } from '../common/authorization/admin-routes';
import { provisionSystemDictionaries } from '../common/initialization/system-dictionaries';
import { PrismaClient } from '../generated/prisma/client';

/** Explicit, one-time bootstrap for a migrated empty database. No demo accounts. */
async function main(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  if (
    !databaseUrl ||
    !username ||
    username.length > 64 ||
    !password ||
    password.length < 16 ||
    password.length > 128
  ) {
    throw new Error(
      'Require DATABASE_URL, BOOTSTRAP_ADMIN_USERNAME (1–64 chars), BOOTSTRAP_ADMIN_PASSWORD (16–128 chars)',
    );
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      // Separate CLI processes must not both bootstrap the same empty database.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
      if ((await tx.user.count()) !== 0)
        throw new Error(
          'Bootstrap requires an empty users table; existing accounts are never overwritten',
        );
      const role = await tx.role.create({
        data: { code: 'bootstrap-admin', name: 'Bootstrap administrator' },
      });
      const user = await tx.user.create({
        data: {
          username,
          passwordHash,
          realName: username,
          homePath: '/system/user',
        },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      for (const code of SYSTEM_PERMISSION_CODES) {
        let menu = await tx.menu.findFirst({
          where: { authCode: code, status: 1, deletedAt: null },
        });
        if (!menu)
          menu = await tx.menu.create({
            data: {
              name: `Bootstrap_${code}`,
              path: '',
              type: 'button',
              authCode: code,
              meta: { title: code, hideInMenu: true },
            },
          });
        await tx.roleMenu.create({
          data: { roleId: role.id, menuId: menu.id },
        });
      }
      await provisionAdminRoutes(tx, role.id);
      await provisionSystemDictionaries(tx);
    });
    console.log(
      'Administrator, management routes and system dictionaries created. Credentials are not printed.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Administrator bootstrap failed');
  process.exitCode = 1;
});
