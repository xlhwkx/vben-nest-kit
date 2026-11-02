import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, map } from "rxjs";
import type { ApiResponseEnvelope } from "../interfaces/api-response.interface";
import { SKIP_ENVELOPE_KEY } from "../decorators/skip-envelope.decorator";

/**
 * 统一成功信封（对照 api-contract-vben.md §1）。
 * refresh 等用 @SkipEnvelope() 跳过（Must 返回纯 token 字符串）。
 */
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseEnvelope<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseEnvelope<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        data,
        error: null,
        message: "ok",
      })),
    );
  }
}
