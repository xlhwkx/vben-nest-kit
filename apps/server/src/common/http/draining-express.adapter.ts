import { Logger } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';

/** Nest calls beforeClose before destroying providers. Drain HTTP in that phase. */
export class DrainingExpressAdapter extends ExpressAdapter {
  private readonly drainLogger = new Logger(DrainingExpressAdapter.name);
  private drainPromise?: Promise<void>;
  drainTimeoutMs = 25_000;
  afterHttpDrain?: (remainingMs: number) => Promise<void>;

  // Nest awaits this hook at runtime although ExpressAdapter declares a void return.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  override beforeClose(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    super.beforeClose();
    const started = Date.now();
    const server = this.getHttpServer();
    this.drainPromise = new Promise<void>((resolve) => {
      if (!server?.listening) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.drainLogger.warn('HTTP drain timed out; closing remaining connections');
        server.closeAllConnections();
        resolve();
      }, this.drainTimeoutMs);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      server.closeIdleConnections();
    }).then(async () => {
      try {
        await this.afterHttpDrain?.(Math.max(0, this.drainTimeoutMs - (Date.now() - started)));
      } catch {
        this.drainLogger.warn('Post-HTTP drain failed; continuing dependency shutdown');
      }
    });
    return this.drainPromise;
  }
}
