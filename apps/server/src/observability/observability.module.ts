import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

@Global()
@Module({
  providers: [
    MetricsService,
    TracingService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService, TracingService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class ObservabilityModule {}
