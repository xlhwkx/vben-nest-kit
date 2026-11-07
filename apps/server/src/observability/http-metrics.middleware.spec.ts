import { ConfigModule } from '@nestjs/config';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Module,
  UseGuards,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import type { Server } from 'node:http';
import { ObservabilityModule } from './observability.module';
import { MetricsService } from './metrics.service';

describe('hTTP response metrics before guards', () => {
  it('counts guard failures and missing routes once, and excludes metrics scrapes', async () => {
    class RejectionGuard implements CanActivate {
      canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
        throw new HttpException('rejected', Number(req.headers['x-status']));
      }
    }
    @Controller()
    class TestController {
      @Get('guarded')
      @UseGuards(RejectionGuard)
      guarded() {
        return 'unreachable';
      }
      @Get('ok') ok() {
        return 'ok';
      }
      @Get('health/metrics') scrape() {
        return 'metrics';
      }
    }
    @Module({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ObservabilityModule],
      controllers: [TestController],
    })
    class TestModule {}
    const app = await NestFactory.create<INestApplication<Server>>(TestModule, {
      logger: false,
      abortOnError: false,
    });
    await app.init();
    try {
      for (const status of [401, 403, 429, 503])
        await request(app.getHttpServer())
          .get('/guarded')
          .set('x-status', String(status))
          .expect(status);
      await request(app.getHttpServer()).get('/ok').expect(200);
      await request(app.getHttpServer()).get('/absent').expect(404);
      await request(app.getHttpServer()).get('/health/metrics?x=1').expect(200);
      const text = app.get(MetricsService).toPrometheus();
      expect(text).toContain('qingzhan_http_requests_total 6\n');
      expect(text).toContain('qingzhan_http_errors_total 1\n');
      for (const status of [200, 401, 403, 404, 429, 503])
        expect(text).toContain(`qingzhan_http_responses_total{status="${status}"} 1`);
    } finally {
      await app.close();
    }
  });
});
