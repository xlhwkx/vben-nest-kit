import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import type { ApiResponseEnvelope } from '../interfaces/api-response.interface';
import { getRequestContext } from '../request-context';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

const databaseErrors: Record<string, { status: HttpStatus; message: string }> = {
  P2000: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Value exceeds the allowed length',
  },
  P2002: { status: HttpStatus.CONFLICT, message: 'Record already exists' },
  P2003: {
    status: HttpStatus.CONFLICT,
    message: 'Related record is missing or still in use',
  },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
  P2024: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Database is busy. Retry the request.',
  },
  P2034: {
    status: HttpStatus.CONFLICT,
    message: 'Concurrent change. Retry the request.',
  },
};

/**
 * 统一错误信封（对照 api-contract-vben.md §1.3 / §1.4）。
 * 业务失败 code=-1；HTTP 状态尽量保留。
 * 非 HttpException（含 Prisma）不回传内部 message/堆栈，避免路径泄漏。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: string | null = message;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = body;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        const msg = obj.message;
        message = Array.isArray(msg)
          ? msg.join(', ')
          : typeof msg === 'string'
            ? msg
            : exception.message;
        error = typeof obj.error === 'string' ? obj.error : exception.message;
      } else {
        message = exception.message;
        error = exception.message;
      }
    } else if (
      exception instanceof PrismaClientKnownRequestError &&
      databaseErrors[exception.code]
    ) {
      const failure = databaseErrors[exception.code];
      status = failure.status;
      message = failure.message;
      error = failure.message;
    } else if (exception instanceof MulterError) {
      status =
        exception.code === 'LIMIT_FILE_SIZE'
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST;
      message = exception.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'Upload failed';
      error = message;
    }
    // else: keep generic 500 — do not leak Prisma paths / stacks

    const envelope: ApiResponseEnvelope<null> = {
      code: -1,
      data: null,
      error,
      message,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const context = getRequestContext();
      // Do not log request bodies, query strings, exception messages or credentials.
      this.logger.error(
        JSON.stringify({
          event: 'http.server_error',
          requestId: context?.requestId ?? null,
          method: context?.method,
          path: context?.path?.split('?')[0],
          status,
          errorType: exception instanceof Error ? exception.name : 'UnknownError',
          frames:
            exception instanceof Error
              ? exception.stack
                  ?.split('\n')
                  .filter((line) => /^\s+at /.test(line))
                  .slice(0, 12)
              : undefined,
        }),
      );
    }
    if (!response.headersSent && !response.destroyed) response.status(status).json(envelope);
  }
}
