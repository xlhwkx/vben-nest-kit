import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    // Skip metrics scrape itself to avoid feedback loop noise.
    if (path.endsWith('/metrics') || path.endsWith('/health/metrics')) {
      return next.handle();
    }
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.metrics.observeHttp(res.statusCode || 200, Date.now() - started);
        },
        error: (err: { status?: number; getStatus?: () => number }) => {
          let status = 500;
          if (typeof err?.getStatus === 'function') {
            status = err.getStatus();
          } else if (typeof err?.status === 'number') {
            status = err.status;
          }
          this.metrics.observeHttp(status, Date.now() - started);
        },
      }),
    );
  }
}
