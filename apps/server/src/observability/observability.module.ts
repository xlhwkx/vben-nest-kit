import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

@Global()
@Module({
  providers: [MetricsService, TracingService, HttpMetricsMiddleware],
  exports: [MetricsService, TracingService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
