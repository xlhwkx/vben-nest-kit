import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const SYSTEM_PERMISSION_CODES = [
  ...['User', 'Role', 'Menu', 'Dept', 'Dict'].flatMap((resource) =>
    ['List', 'Create', 'Update', 'Delete'].map((action) => `System:${resource}:${action}`),
  ),
  'System:Audit:List',
  'System:User:AssignRole',
];

/** Menus are the authorization source. Read the DB so revocation has no cache window. */
export async function readPermissionCodes(
  prisma: Pick<PrismaService, 'menu'>,
  userId: string,
): Promise<string[]> {
  const menus = await prisma.menu.findMany({
    where: {
      status: 1,
      deletedAt: null,
      authCode: { not: null },
      roles: { some: { role: { status: 1, users: { some: { userId } } } } },
    },
    select: { authCode: true },
  });
  return [...new Set(menus.flatMap((menu) => (menu.authCode ? [menu.authCode] : [])))].sort();
}

/** A delegated administrator can grant only permissions they currently hold. */
export async function assertGrantableCodes(
  prisma: Pick<PrismaService, 'menu'>,
  actorId: string,
  codes: string[],
  requiredCode?: string,
): Promise<void> {
  const held = new Set(await readPermissionCodes(prisma, actorId));
  if ((requiredCode && !held.has(requiredCode)) || codes.some((code) => !held.has(code))) {
    throw new ForbiddenException('Cannot grant permissions outside your authority');
  }
}

/** Include disabled grants: enabling a role/menu must not bypass delegation limits. */
export async function assertGrantableMenus(
  prisma: Pick<PrismaService, 'menu'>,
  actorId: string,
  where: Prisma.MenuWhereInput,
  requiredCode?: string,
): Promise<void> {
  const menus = await prisma.menu.findMany({
    where: { ...where, deletedAt: null, authCode: { not: null } },
    select: { authCode: true },
  });
  await assertGrantableCodes(
    prisma,
    actorId,
    menus.flatMap((menu) => (menu.authCode ? [menu.authCode] : [])),
    requiredCode,
  );
}
