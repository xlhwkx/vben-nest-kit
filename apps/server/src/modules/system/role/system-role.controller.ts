import { editVersionSchema } from '../../../common/validation/edit-version';
import type {
  SystemRoleListQuery,
  SystemRoleCreateInput,
  SystemRoleUpdateInput,
} from './system-role.service';
import {
  parseRequest,
  uuidSchema,
  requiredText,
  idArraySchema,
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
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../../common/decorators/current-user.decorator';
import { z } from 'zod';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SystemRoleService } from './system-role.service';

/** Create: name required; code optional (Nest auto-slugs when omitted — mock/UI have no code). */
const roleCreateSchema = z.object({
  name: requiredText(128),
  code: requiredText(64).optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
  permissions: idArraySchema.optional(),
});

/**
 * Update: editable fields optional; the current edit version is required.
 * At least one field required.
 */
const roleUpdateSchema = z
  .object({
    version: editVersionSchema,
    name: requiredText(128).optional(),
    code: requiredText(64).optional(),
    status: z.union([z.literal(0), z.literal(1)]).optional(),
    remark: z.union([z.string().max(512), z.null()]).optional(),
    permissions: idArraySchema.optional(),
  })
  .refine((v) => Object.keys(v).some((key) => key !== 'version'), {
    message: 'at least one field is required',
  });

function parseCreateBody(body: unknown): SystemRoleCreateInput {
  return parseRequest(roleCreateSchema, body);
}

function parseUpdateBody(body: unknown): SystemRoleUpdateInput {
  return parseRequest(roleUpdateSchema, body);
}

@Controller({ path: 'system/role', version: [VERSION_NEUTRAL, '1'] })
export class SystemRoleController {
  constructor(private readonly roles: SystemRoleService) {}

  @Get('list')
  @RequirePermissions('System:Role:List')
  async list(@Query() query: SystemRoleListQuery) {
    return this.roles.list(query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:Role:Create')
  async create(@Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.roles.create(parseCreateBody(body), actor);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:Role:Update')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.roles.update(parseRequest(uuidSchema, id), parseUpdateBody(body), actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:Role:Delete')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.roles.remove(parseRequest(uuidSchema, id), actor);
  }
}
