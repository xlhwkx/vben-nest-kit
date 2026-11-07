import { Controller, Get, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { SystemDictService } from './system-dict.service';
import { optionalQueryText, parseQuery } from '../../../common/validation/request-validation';
import { z } from 'zod';

/** Frontend dict pull APIs: /api/dict/* and /api/v1/dict/* */
@Controller({ path: 'dict', version: [VERSION_NEUTRAL, '1'] })
export class DictController {
  constructor(private readonly dicts: SystemDictService) {}

  @Get('all')
  async all() {
    return this.dicts.getAllEnabled();
  }

  @Get('data')
  async data(@Query() query: unknown) {
    const parsed = parseQuery(z.object({ code: optionalQueryText(64) }), query);
    if (!parsed.code) return [];
    return this.dicts.getEnabledByCode(parsed.code);
  }

  @Get('version')
  async version() {
    return this.dicts.getVersion();
  }
}
