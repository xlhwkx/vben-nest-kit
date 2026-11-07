import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Observe the final response, including requests rejected before interceptors run. */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const path = String(req.originalUrl ?? req.url).split('?')[0];
    if (/\/health\/metrics\/?$/.test(path)) {
      next();
      return;
    }
    const started = performance.now();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      res.off('finish', record);
      res.off('close', record);
      this.metrics.observeHttp(
        res.writableFinished ? res.statusCode : 499,
        performance.now() - started,
      );
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  }
}
