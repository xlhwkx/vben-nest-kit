import { editVersionSchema } from '../../../common/validation/edit-version';
import {
  type SystemUserListQuery,
  SystemUserService,
  type SystemUserCreateInput,
  type SystemUserUpdateInput,
} from './system-user.service';
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

const createBodySchema = z.object({
  username: requiredText(64),
  password: z.string().min(6).max(128),
  name: requiredText(128),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  gender: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  deptId: uuidSchema.nullable().optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
  homePath: z.union([z.string().max(255), z.null()]).optional(),
  avatar: z.union([z.string().max(512), z.null()]).optional(),
  roles: idArraySchema.optional(),
});

const updateBodySchema = z
  .object({
    version: editVersionSchema,
    username: requiredText(64).optional(),
    password: z.string().min(6).max(128).optional(),
    name: requiredText(128).optional(),
    status: z.union([z.literal(0), z.literal(1)]).optional(),
    gender: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    deptId: uuidSchema.nullable().optional(),
    remark: z.union([z.string().max(512), z.null()]).optional(),
    homePath: z.union([z.string().max(255), z.null()]).optional(),
    avatar: z.union([z.string().max(512), z.null()]).optional(),
    roles: idArraySchema.optional(),
  })
  .refine((v) => Object.keys(v).some((key) => key !== 'version'), {
    message: 'at least one field is required',
  });

function parseCreateBody(body: unknown): SystemUserCreateInput {
  return parseRequest(createBodySchema, body);
}

function parseUpdateBody(body: unknown): SystemUserUpdateInput {
  return parseRequest(updateBodySchema, body);
}

@Controller({ path: 'system/user', version: [VERSION_NEUTRAL, '1'] })
export class SystemUserController {
  constructor(private readonly users: SystemUserService) {}

  @Get('list')
  @RequirePermissions('System:User:List')
  async list(@Query() query: SystemUserListQuery) {
    return this.users.list(query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:User:Create')
  async create(@Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.users.create(parseCreateBody(body), actor);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:User:Update')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.users.update(parseRequest(uuidSchema, id), parseUpdateBody(body), actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:User:Delete')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.users.remove(parseRequest(uuidSchema, id), actor);
  }
}
