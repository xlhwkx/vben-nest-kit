import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { finalize } from 'rxjs';

/** Per-process budget: reject excess uploads before buffering; no waiting queue. */
@Injectable()
export class UploadCapacityInterceptor implements NestInterceptor {
  private active = 0;
  constructor(private readonly config: ConfigService) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    const limit = this.config.get<number>('UPLOAD_MAX_CONCURRENT') ?? 4;
    if (this.active >= limit) throw new ServiceUnavailableException('Upload capacity exhausted');
    this.active++;
    // Keep a slot until parsing AND storage finish, including storage after client disconnect.
    return next.handle().pipe(finalize(() => this.active--));
  }
}
