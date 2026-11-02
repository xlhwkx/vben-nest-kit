import { Injectable, Logger } from '@nestjs/common';
import { getRequestContext } from '../common/request-context';

/** Structured JSON logs with requestId — use for auth/upload error paths. */
@Injectable()
export class StructuredLogger {
  constructor(private readonly nest = new Logger('Qingzhan')) {}

  private base(extra: Record<string, unknown>) {
    const ctx = getRequestContext();
    return {
      ts: new Date().toISOString(),
      requestId: ctx?.requestId ?? null,
      userId: ctx?.userId ?? null,
      path: ctx?.path ?? null,
      ...extra,
    };
  }

  info(msg: string, extra: Record<string, unknown> = {}): void {
    this.nest.log(JSON.stringify(this.base({ msg, ...extra })));
  }

  warn(msg: string, extra: Record<string, unknown> = {}): void {
    this.nest.warn(JSON.stringify(this.base({ msg, ...extra })));
  }

  error(msg: string, extra: Record<string, unknown> = {}): void {
    this.nest.error(JSON.stringify(this.base({ msg, ...extra })));
  }
}
