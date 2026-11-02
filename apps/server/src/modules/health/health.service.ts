import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MetricsService } from '../../observability/metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  live() {
    this.metrics.incHealthLive();
    return { status: 'ok' as const };
  }

  check() {
    return {
      status: 'ok' as const,
      service: 'qingzhan-server',
    };
  }

  /**
   * Readiness: Postgres + Redis must both answer.
   * Failures → 503 envelope (no stack / internal detail).
   */
  async ready() {
    let postgres = false;
    let redis = false;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = true;
    } catch {
      postgres = false;
    }

    try {
      redis = await this.redis.ping();
    } catch {
      redis = false;
    }

    if (!postgres || !redis) {
      this.metrics.incHealthReady(false);
      const failed = [postgres ? null : 'postgres', redis ? null : 'redis'].filter(Boolean);
      throw new ServiceUnavailableException({
        message: 'Service Unavailable',
        error: `not ready: ${failed.join(',')}`,
      });
    }

    this.metrics.incHealthReady(true);
    return {
      status: 'ok' as const,
      postgres: true,
      redis: true,
    };
  }
}
