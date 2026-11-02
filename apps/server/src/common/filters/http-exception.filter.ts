import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { MulterError } from "multer";
import type { ApiResponseEnvelope } from "../interfaces/api-response.interface";

/**
 * 统一错误信封（对照 api-contract-vben.md §1.3 / §1.4）。
 * 业务失败 code=-1；HTTP 状态尽量保留。
 * 非 HttpException（含 Prisma）不回传内部 message/堆栈，避免路径泄漏。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let error: string | null = message;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
        error = body;
      } else if (typeof body === "object" && body !== null) {
        const obj = body as Record<string, unknown>;
        const msg = obj.message;
        message = Array.isArray(msg)
          ? msg.join(", ")
          : typeof msg === "string"
            ? msg
            : exception.message;
        error =
          typeof obj.error === "string" ? obj.error : exception.message;
      } else {
        message = exception.message;
        error = exception.message;
      }
    } else if (exception instanceof MulterError) {
      status =
        exception.code === "LIMIT_FILE_SIZE"
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST;
      message =
        exception.code === "LIMIT_FILE_SIZE"
          ? "File too large"
          : "Upload failed";
      error = message;
    }
    // else: keep generic 500 — do not leak Prisma paths / stacks

    const envelope: ApiResponseEnvelope<null> = {
      code: -1,
      data: null,
      error,
      message,
    };

    response.status(status).json(envelope);
  }
}
