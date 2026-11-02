import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiResponseEnvelope } from '../interfaces/api-response.interface';

/**
 * 统一成功信封（对照 api-contract-vben.md §1）。
 * 下一刀：refresh 纯字符串例外需跳过本拦截器。
 */
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseEnvelope<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseEnvelope<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        data,
        error: null,
        message: 'ok',
      })),
    );
  }
}
