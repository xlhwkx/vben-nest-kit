import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { authorizationMutation } from './authorization-mutation';

describe('serialized authorization mutations', () => {
  const actor = {
    userId: '00000000-0000-7000-8000-000000000001',
    username: 'admin',
    tokenVersion: 2,
  };
  function fixture() {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ id: actor.userId }]),
      user: {
        findFirst: jest.fn().mockResolvedValue({ ...actor, id: actor.userId }),
      },
      menu: {
        findMany: jest.fn().mockResolvedValue([{ authCode: 'System:Role:Update' }]),
      },
    };
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    return { tx, prisma };
  }
  it('rechecks route authority after obtaining the lock, before running the write', async () => {
    const { tx, prisma } = fixture();
    tx.menu.findMany.mockResolvedValue([]);
    const write = jest.fn();
    await expect(
      authorizationMutation(prisma as never, actor, 'System:Role:Update', write),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(write).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it('rejects a security version changed while the request was waiting', async () => {
    const { tx, prisma } = fixture();
    tx.user.findFirst.mockResolvedValue({
      ...actor,
      id: actor.userId,
      tokenVersion: 3,
    });
    const write = jest.fn();
    await expect(
      authorizationMutation(prisma as never, actor, 'System:Role:Update', write),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects a transaction that would remove the last complete administrator', async () => {
    const { tx, prisma } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: actor.userId }])
      .mockResolvedValueOnce([{ id: actor.userId }])
      .mockResolvedValueOnce([]);
    await expect(
      authorizationMutation(
        prisma as never,
        actor,
        'System:Role:Update',
        jest.fn().mockResolvedValue('written'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows a mutation while another full administrator remains', async () => {
    const { tx, prisma } = fixture();
    const write = jest.fn().mockResolvedValue('written');
    await expect(
      authorizationMutation(prisma as never, actor, 'System:Role:Update', write),
    ).resolves.toBe('written');
    expect(write).toHaveBeenCalledWith(tx);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
