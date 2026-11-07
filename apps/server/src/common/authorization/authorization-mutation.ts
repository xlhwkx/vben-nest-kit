import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';
import { assertGrantableCodes, SYSTEM_PERMISSION_CODES } from './permission-codes';

/** A complete system administrator may hold the required codes across multiple roles. */
async function hasAdministrator(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id AND r.status = 1
    JOIN role_menus rm ON rm.role_id = r.id
    JOIN menus m ON m.id = rm.menu_id AND m.status = 1 AND m.deleted_at IS NULL
    WHERE u.status = 1 AND u.deleted_at IS NULL
      AND m.auth_code = ANY(${SYSTEM_PERMISSION_CODES}::text[])
    GROUP BY u.id HAVING count(DISTINCT m.auth_code) = ${SYSTEM_PERMISSION_CODES.length}
    LIMIT 1`;
  return rows.length > 0;
}

/**
 * All runtime system management writers use this lock, including department
 * topology and user assignments. They must share one lock to prevent orphan links.
 * READ COMMITTED ensures reads after a lock wait see the preceding writer's commit.
 * Keep every query on tx: opening nested transactions can exhaust the connection pool.
 */
export async function authorizationMutation<T>(
  prisma: PrismaService,
  actor: AuthUser,
  requiredCode: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7339202601::bigint)`;
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.userId}::uuid FOR UPDATE`;
        const current = await tx.user.findFirst({
          where: { id: actor.userId, status: 1, deletedAt: null },
        });
        if (!current || current.tokenVersion !== actor.tokenVersion) {
          throw new UnauthorizedException('Credentials changed. Please log in again.');
        }
        // Recheck route permission under the lock; the request guard ran before waiting.
        await assertGrantableCodes(tx, actor.userId, [], requiredCode);
        const hadAdministrator = await hasAdministrator(tx);
        const result = await run(tx);
        if (hadAdministrator && !(await hasAdministrator(tx))) {
          throw new ConflictException('Cannot remove the last active system administrator');
        }
        return result;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 20_000 },
    )
    .catch((error: unknown) => {
      const failure = error as {
        code?: string;
        meta?: {
          code?: string;
          driverAdapterError?: { cause?: { originalCode?: string } };
        };
      } | null;
      const sqlState =
        failure?.meta?.code ?? failure?.meta?.driverAdapterError?.cause?.originalCode;
      if (
        ['P2024', 'P2028'].includes(failure?.code ?? '') ||
        sqlState === '55P03' ||
        sqlState === '40P01'
      ) {
        throw new ServiceUnavailableException('Authorization changes are busy. Retry the request.');
      }
      throw error;
    });
}
