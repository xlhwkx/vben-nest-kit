import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import {
  type DictTypeListQuery,
  SystemDictService,
  type DictTypeInput,
} from './system-dict.service';
import {
  parseRequest,
  uuidSchema,
  requiredText,
  optionalQueryId,
  parseQuery,
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

const typeBodySchema = z.object({
  name: requiredText(128).optional(),
  code: requiredText(64).optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
});

function parseTypeBody(body: unknown, requireNameCode: boolean): DictTypeInput {
  const d = parseRequest(typeBodySchema, body ?? {});
  if (!requireNameCode && Object.keys(d).length === 0) {
    throw new BadRequestException('at least one field is required');
  }
  if (requireNameCode) {
    if (!d.name?.trim()) throw new BadRequestException('name is required');
    if (!d.code?.trim()) throw new BadRequestException('code is required');
  }
  const out: DictTypeInput = {};
  if (d.name !== undefined) out.name = d.name;
  if (d.code !== undefined) out.code = d.code;
  if (d.status !== undefined) out.status = d.status;
  if (d.remark !== undefined) out.remark = d.remark;
  return out;
}

@Controller({ path: 'system/dict/type', version: [VERSION_NEUTRAL, '1'] })
export class SystemDictTypeController {
  constructor(private readonly dicts: SystemDictService) {}

  @Get('list')
  @RequirePermissions('System:Dict:List')
  async list(@Query() query: DictTypeListQuery) {
    return this.dicts.listTypes(query);
  }

  @Get('code-exists')
  @RequirePermissions('System:Dict:List')
  async codeExists(@Query() query: unknown) {
    const parsed = parseQuery(z.object({ code: requiredText(64), id: optionalQueryId }), query);
    return this.dicts.codeExists(parsed.code, parsed.id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:Dict:Create')
  async create(@Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.dicts.createType(parseTypeBody(body, true), actor);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:Dict:Update')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.dicts.updateType(parseRequest(uuidSchema, id), parseTypeBody(body, false), actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:Dict:Delete')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.dicts.deleteType(parseRequest(uuidSchema, id), actor);
  }
}
