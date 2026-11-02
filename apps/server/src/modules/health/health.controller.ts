import {
  Controller,
  Get,
  Headers,
  Res,
  UnauthorizedException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { MetricsService } from '../../observability/metrics.service';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: [VERSION_NEUTRAL, '1'] })
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Basic health (legacy)' })
  check() {
    return this.health.check();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness — process up, no dependency checks' })
  live() {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness — Postgres + Redis ping' })
  ready() {
    return this.health.ready();
  }

  /**
   * Prometheus text metrics. Intended for internal scrapers only.
   * Optional METRICS_TOKEN → require Authorization: Bearer <token>.
   * Disable with METRICS_ENABLED=false.
   */
  @Get('metrics')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Prometheus metrics (internal scrape)' })
  metricsEndpoint(
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): void {
    const enabled = this.config.get<boolean>('METRICS_ENABLED');
    if (enabled === false) {
      res.status(404).type('text/plain').send('metrics disabled\n');
      return;
    }
    const token = this.config.get<string>('METRICS_TOKEN');
    if (token) {
      const expected = `Bearer ${token}`;
      if (authorization !== expected) {
        throw new UnauthorizedException({
          message: 'Unauthorized',
          error: 'metrics token required',
        });
      }
    }
    res
      .status(200)
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(this.metrics.toPrometheus());
  }
}
