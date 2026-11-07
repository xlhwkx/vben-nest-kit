/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('refresh transaction failure handling', () => {
  const userId = '00000000-0000-7000-8000-000000000001';
  function fixture() {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: userId,
          username: 'member',
          tokenVersion: 3,
        }),
      },
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({ familyId: userId }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: userId, jti: 'old' }),
      signAsync: jest.fn().mockResolvedValue('signed'),
    };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      { get: () => undefined, getOrThrow: () => 'secret' } as never,
      {} as never,
      {
        record: jest.fn(),
        recordInTransaction: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
    );
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    return { tx, prisma, jwt, service, res };
  }
  it('rejects a consumed/revoked token without issuing a replacement', async () => {
    const { tx, service, res } = fixture();
    tx.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh('old-token', res as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
  it('rejects a different expected account without rotating or clearing its cookie', async () => {
    const { prisma, service, res } = fixture();
    await expect(
      service.refresh('old-token', res as never, '00000000-0000-7000-8000-000000000002'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
  it('consumes and replaces within the same transaction using the current security version', async () => {
    const { tx, service, res } = fixture();
    await expect(service.refresh('old-token', res as never)).resolves.toBe('signed');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          tokenVersion: 3,
          revokedAt: null,
        }),
      }),
    );
    expect(tx.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          tokenVersion: 3,
          familyId: userId,
        }),
      }),
    );
    expect(res.cookie).toHaveBeenCalled();
  });
  it('does not publish cookies when the transaction fails to commit', async () => {
    const { prisma, tx, service, res } = fixture();
    prisma.$transaction.mockImplementation(async (run) => {
      await run(tx);
      throw new Error('commit failed');
    });
    await expect(service.refresh('old-token', res as never)).rejects.toThrow('commit failed');
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
  it.each([undefined, 'invalid-token'])(
    'does not clear shared cookies for a missing or invalid refresh: %s',
    async (cookie) => {
      const { service, res, jwt } = fixture();
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await expect(service.refresh(cookie, res as never)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    },
  );
  it('propagates logout storage failures instead of reporting false success', async () => {
    const { prisma, service, res } = fixture();
    prisma.$transaction.mockRejectedValue(new Error('storage unavailable'));
    await expect(service.logout('old-token', res as never)).rejects.toThrow('storage unavailable');
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
  it('does not revoke another account or clear its cookie on explicit logout', async () => {
    const { prisma, service, res } = fixture();
    await expect(
      service.logout('old-token', res as never, '00000000-0000-7000-8000-000000000002'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
