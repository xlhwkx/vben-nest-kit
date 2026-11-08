import { PrismaPg } from '@prisma/adapter-pg';
import {
  readPermissionCodes,
  SYSTEM_PERMISSION_CODES,
} from '../common/authorization/permission-codes';
import { provisionSystemDictionaries } from '../common/initialization/system-dictionaries';
import { PrismaClient } from '../generated/prisma/client';

/** Explicit, repeatable upgrade; never creates demo accounts or overwrites configuration. */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const username = process.env.SYSTEM_DATA_USERNAME?.trim();
  if (!databaseUrl || !username) throw new Error('Require DATABASE_URL and SYSTEM_DATA_USERNAME');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
        const user = await tx.user.findFirst({
          where: { username, status: 1, deletedAt: null },
        });
        if (!user) throw new Error('Active administrator not found');
        const held = new Set(await readPermissionCodes(tx, user.id));
        if (!SYSTEM_PERMISSION_CODES.every((code) => held.has(code))) {
          throw new Error('This command requires an administrator holding all system permissions');
        }
        const changes = await provisionSystemDictionaries(tx);
        if (changes.created.length > 0) {
          await tx.auditLog.create({
            data: {
              userId: user.id,
              username: user.username,
              action: 'system.dict.provision',
              module: 'system.dict',
              status: 200,
              detail: changes,
            },
          });
        }
        return changes;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 20_000 },
    );
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'System dictionary provisioning failed');
  process.exitCode = 1;
});
