jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('readiness work bound', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([true, false])(
    'coalesces requests and caches both success/failure: %s',
    async (healthy) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prisma = { $queryRaw: jest.fn(() => gate) };
      const redis = { ping: jest.fn().mockResolvedValue(healthy) };
      const metrics = { incHealthReady: jest.fn() };
      const service = new HealthService(prisma as never, redis as never, metrics as never);
      let now = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const results = Promise.allSettled(Array.from({ length: 20 }, () => service.ready()));
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      release();
      const settled = await results;
      expect(
        settled.every((result) => result.status === (healthy ? 'fulfilled' : 'rejected')),
      ).toBe(true);
      if (healthy) await expect(service.ready()).resolves.toMatchObject({ status: 'ok' });
      else await expect(service.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(redis.ping).toHaveBeenCalledTimes(1);
      now += 1001;
      await service.ready().catch(() => {});
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    },
  );
});
