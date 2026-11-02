import { Body, Controller, Get, HttpCode, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { TimezoneService } from './timezone.service';

/**
 * P2 timezone APIs — api-contract-vben.md §8
 * GET  /api/timezone/getTimezone        Bearer → string | null
 * GET  /api/timezone/getTimezoneOptions public → { label, value }[]
 * POST /api/timezone/setTimezone        Bearer body { timezone }
 */
@Controller({ path: 'timezone', version: [VERSION_NEUTRAL, '1'] })
export class TimezoneController {
  constructor(private readonly timezones: TimezoneService) {}

  @Get('getTimezone')
  getTimezone() {
    return this.timezones.getTimezone();
  }

  @Public()
  @Get('getTimezoneOptions')
  getTimezoneOptions() {
    return this.timezones.getTimezoneOptions();
  }

  @Post('setTimezone')
  @HttpCode(200)
  setTimezone(@Body() body: { timezone?: unknown }) {
    return this.timezones.setTimezone(body?.timezone);
  }
}
