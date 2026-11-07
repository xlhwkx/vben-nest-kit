import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import {
  type DictDataListQuery,
  SystemDictService,
  type DictDataInput,
} from './system-dict.service';
import {
  parseRequest,
  uuidSchema,
  requiredText,
  int32Schema,
} from '../../../common/validation/request-validation';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';

const dataBodySchema = z.object({
  dictCode: requiredText(64).optional(),
  label: requiredText(128).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  color: z.union([z.string().max(64), z.null()]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
  sort: int32Schema.optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
});

function parseDataBody(body: unknown, requireCreate: boolean): DictDataInput {
  const d = parseRequest(dataBodySchema, body ?? {});
  if (!requireCreate && Object.keys(d).length === 0) {
    throw new BadRequestException('at least one field is required');
  }
  if (requireCreate) {
    if (!d.dictCode?.trim()) throw new BadRequestException('dictCode is required');
    if (!d.label?.trim()) throw new BadRequestException('label is required');
    if (d.value === undefined) throw new BadRequestException('value is required');
  }
  const out: DictDataInput = {};
  if (d.dictCode !== undefined) out.dictCode = d.dictCode;
  if (d.label !== undefined) out.label = d.label;
  if (d.value !== undefined) out.value = d.value;
  if (d.color !== undefined) out.color = d.color;
  if (d.remark !== undefined) out.remark = d.remark;
  if (d.sort !== undefined) out.sort = d.sort;
  if (d.status !== undefined) out.status = d.status;
  return out;
}

@Controller({ path: 'system/dict/data', version: [VERSION_NEUTRAL, '1'] })
export class SystemDictDataController {
  constructor(private readonly dicts: SystemDictService) {}

  @Get('list')
  @RequirePermissions('System:Dict:List')
  async list(@Query() query: DictDataListQuery) {
    return this.dicts.listData(query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:Dict:Create')
  async create(@Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.dicts.createData(parseDataBody(body, true), actor);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:Dict:Update')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.dicts.updateData(parseRequest(uuidSchema, id), parseDataBody(body, false), actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:Dict:Delete')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.dicts.deleteData(parseRequest(uuidSchema, id), actor);
  }
}
