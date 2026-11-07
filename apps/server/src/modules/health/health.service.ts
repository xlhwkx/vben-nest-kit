import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MetricsService } from '../../observability/metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class HealthService {
  private readyInFlight?: Promise<{
    status: 'ok';
    postgres: true;
    redis: true;
  }>;
  private readyCache?: {
    expiresAt: number;
    result?: { status: 'ok'; postgres: true; redis: true };
    error?: Error;
  };
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
    const cached = this.readyCache;
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.error) throw cached.error;
      return cached.result!;
    }
    if (this.readyInFlight) return this.readyInFlight;
    this.readyInFlight = this.probeReady()
      .then(
        (result) => {
          this.readyCache = { result, expiresAt: Date.now() + 1000 };
          return result;
        },
        (error: unknown) => {
          const failure =
            error instanceof Error ? error : new ServiceUnavailableException('Not ready');
          this.readyCache = { error: failure, expiresAt: Date.now() + 1000 };
          throw failure;
        },
      )
      .finally(() => {
        this.readyInFlight = undefined;
      });
    return this.readyInFlight;
  }

  private async probeReady(): Promise<{
    status: 'ok';
    postgres: true;
    redis: true;
  }> {
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
