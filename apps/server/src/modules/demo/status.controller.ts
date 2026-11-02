import {
  Controller,
  Get,
  HttpException,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Demo error envelope: GET /api/status?status=500
 * Sets HTTP status from query and returns contract error shape via filter.
 */
@Public()
@Controller({ path: 'status', version: [VERSION_NEUTRAL, '1'] })
export class StatusController {
  @Get()
  status(@Query('status') status?: string): never {
    const raw = Array.isArray(status) ? status[0] : status;
    const n = Number.parseInt(String(raw ?? '500'), 10);
    const httpStatus =
      Number.isFinite(n) && n >= 100 && n <= 599 ? n : 500;
    const label = String(httpStatus);
    throw new HttpException(
      { message: label, error: label },
      httpStatus,
    );
  }
}
