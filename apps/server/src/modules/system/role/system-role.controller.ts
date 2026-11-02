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
import { SystemRoleService } from './system-role.service';
import type { SystemRoleCreateInput, SystemRoleUpdateInput } from './system-role.service';

/** Create: name required; code optional (Nest auto-slugs when omitted — mock/UI have no code). */
const roleCreateSchema = z.object({
  name: z.string().min(1).max(128),
  code: z.string().min(1).max(64).optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * Update: all fields optional (playground status toggle sends `{ status }` only).
 * At least one field required.
 */
const roleUpdateSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    code: z.string().min(1).max(64).optional(),
    status: z.union([z.literal(0), z.literal(1)]).optional(),
    remark: z.union([z.string().max(512), z.null()]).optional(),
    permissions: z.array(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field is required',
  });

function parseCreateBody(body: unknown): SystemRoleCreateInput {
  const parsed = roleCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'BadRequestException',
      error: parsed.error.issues.map((i) => i.message).join('; '),
    });
  }
  const d = parsed.data;
  return {
    name: d.name,
    code: d.code,
    status: d.status,
    remark: d.remark,
    permissions: d.permissions,
  };
}

function parseUpdateBody(body: unknown): SystemRoleUpdateInput {
  const parsed = roleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'BadRequestException',
      error: parsed.error.issues.map((i) => i.message).join('; '),
    });
  }
  return parsed.data;
}

@Controller({ path: 'system/role', version: [VERSION_NEUTRAL, '1'] })
export class SystemRoleController {
  constructor(private readonly roles: SystemRoleService) {}

  /** list: Bearer only; no write permission required */
  @Get('list')
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('name') name?: string,
    @Query('id') id?: string,
    @Query('remark') remark?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('status') status?: string,
  ) {
    return this.roles.list({
      page,
      pageSize,
      name,
      id,
      remark,
      startTime,
      endTime,
      status,
    });
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:Role:Create')
  async create(@Body() body: unknown) {
    return this.roles.create(parseCreateBody(body));
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:Role:Update')
  async update(@Param('id') id: string, @Body() body: unknown) {
    if (!id?.trim()) {
      throw new BadRequestException('id is required');
    }
    return this.roles.update(id, parseUpdateBody(body));
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:Role:Delete')
  async remove(@Param('id') id: string) {
    if (!id?.trim()) {
      throw new BadRequestException('id is required');
    }
    return this.roles.remove(id);
  }
}
