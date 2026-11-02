/* oxlint-disable import/first -- jest.mock must hoist before AuthService pulls Prisma */
jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: function PrismaService() {
    return undefined;
  },
}));

import { ServiceUnavailableException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('authService auth:fail fail-closed', () => {
  const metrics = {
    incLoginFailClosed: jest.fn(),
    incLoginLocked: jest.fn(),
    incLoginFailed: jest.fn(),
    incLoginSuccess: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const config = {
    get: (k: string) => {
      if (k === 'AUTH_FAIL_WINDOW_SEC') return 900;
      if (k === 'AUTH_FAIL_MAX') return 5;
      return undefined;
    },
    getOrThrow: (k: string) => k,
  };

  it('login → 503 when Redis getStrict throws (lock check fail-closed)', async () => {
    const redis = {
      getStrict: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      incrWithTtlStrict: jest.fn(),
      del: jest.fn(),
    };
    const svc = new AuthService(
      {} as never,
      {} as never,
      config as never,
      redis as never,
      audit as never,
      metrics as never,
    );
    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as never;
    await expect(
      svc.login({ username: 'vben', password: 'x' }, res, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(redis.getStrict).toHaveBeenCalled();
    expect(metrics.incLoginFailClosed).toHaveBeenCalled();
  });

  it('login → 503 when incrWithTtlStrict throws after bad credentials', async () => {
    const redis = {
      getStrict: jest.fn().mockResolvedValue(null),
      incrWithTtlStrict: jest.fn().mockRejectedValue(new Error('redis down')),
      del: jest.fn(),
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new AuthService(
      prisma as never,
      {} as never,
      config as never,
      redis as never,
      audit as never,
      metrics as never,
    );
    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as never;
    await expect(
      svc.login({ username: 'nobody', password: 'bad' }, res, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(redis.incrWithTtlStrict).toHaveBeenCalled();
    expect(metrics.incLoginFailClosed).toHaveBeenCalled();
  });
});
