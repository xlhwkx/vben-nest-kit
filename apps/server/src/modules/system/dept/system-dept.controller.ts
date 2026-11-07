import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import {
  parseRequest,
  uuidSchema,
  requiredText,
  parentIdSchema,
} from '../../../common/validation/request-validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SystemDeptService } from './system-dept.service';
import type { SystemDeptInput } from './system-dept.service';

const deptBodySchema = z.object({
  name: requiredText(128),
  pid: parentIdSchema.optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
});

function parseDeptBody(body: unknown): SystemDeptInput {
  return parseRequest(deptBodySchema, body);
}

@Controller({ path: 'system/dept', version: [VERSION_NEUTRAL, '1'] })
export class SystemDeptController {
  constructor(private readonly depts: SystemDeptService) {}

  /** Department tree; non-paginated and protected by the read permission. */
  @Get('list')
  @RequirePermissions('System:Dept:List')
  async list() {
    return this.depts.list();
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:Dept:Create')
  async create(@Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.depts.create(parseDeptBody(body), actor);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:Dept:Update')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.depts.update(parseRequest(uuidSchema, id), parseDeptBody(body), actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:Dept:Delete')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.depts.remove(parseRequest(uuidSchema, id), actor);
  }
}
