import { ForbiddenException } from '@nestjs/common';
import {
  assertGrantableCodes,
  assertGrantableMenus,
  readPermissionCodes,
} from './permission-codes';

describe('effective authorization', () => {
  it('filters disabled/deleted menus and disabled roles, deduplicates codes without a cache', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        { authCode: 'B' },
        { authCode: 'A' },
        { authCode: 'A' },
        { authCode: null },
      ])
      .mockResolvedValueOnce([]);
    const prisma = { menu: { findMany } } as never;
    expect(await readPermissionCodes(prisma, 'user')).toEqual(['A', 'B']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: 1,
        deletedAt: null,
        authCode: { not: null },
        roles: {
          some: { role: { status: 1, users: { some: { userId: 'user' } } } },
        },
      },
      select: { authCode: true },
    });
    expect(await readPermissionCodes(prisma, 'user')).toEqual([]);
  });
  it('rejects role assignment without AssignRole even for an empty role list', async () => {
    const prisma = {
      menu: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;
    await expect(
      assertGrantableMenus(prisma, 'actor', { id: { in: [] } }, 'System:User:AssignRole'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a higher grant, including a currently disabled menu', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ authCode: 'System:User:Delete' }])
      .mockResolvedValueOnce([{ authCode: 'System:User:List' }]);
    await expect(
      assertGrantableMenus({ menu: { findMany } } as never, 'actor', {
        id: 'disabled-menu',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'disabled-menu', deletedAt: null, authCode: { not: null } },
      select: { authCode: true },
    });
  });
  it('permits a subset of held authority', async () => {
    const prisma = {
      menu: {
        findMany: jest.fn().mockResolvedValue([{ authCode: 'System:User:List' }]),
      },
    } as never;
    await expect(
      assertGrantableCodes(prisma, 'actor', ['System:User:List']),
    ).resolves.toBeUndefined();
  });
});
