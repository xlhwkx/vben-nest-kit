import { editVersionSchema } from '../../../common/validation/edit-version';
import { menuMetaSchema } from '../../../common/validation/menu-meta';
import {
  parseRequest,
  uuidSchema,
  requiredText,
  parentIdSchema,
  optionalQueryId,
  parseQuery,
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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { z } from 'zod';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SystemMenuService } from './system-menu.service';
import type { SystemMenuInput } from './system-menu.service';

const menuTypes = ['catalog', 'menu', 'button', 'embedded', 'link'] as const;

const menuBodySchema = z.object({
  name: requiredText(128),
  path: z.string().max(255),
  type: z.enum(menuTypes),
  pid: parentIdSchema.optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  authCode: z.union([z.string().max(128), z.null()]).optional(),
  component: z.union([z.string().max(255), z.null()]).optional(),
  redirect: z.union([z.string().max(255), z.null()]).optional(),
  meta: menuMetaSchema.nullable().optional(),
});

function parseMenuBody(body: unknown): SystemMenuInput {
  return parseRequest(menuBodySchema, body);
}

@Controller({ path: 'system/menu', version: [VERSION_NEUTRAL, '1'] })
export class SystemMenuController {
  constructor(private readonly menus: SystemMenuService) {}

  /** Read permission is required for the tree and uniqueness checks. */
  @Get('list')
  @RequirePermissions('System:Menu:List')
  async list() {
    return this.menus.list();
  }

  @Get('name-exists')
  @RequirePermissions('System:Menu:List')
  async nameExists(@Query() query: unknown): Promise<boolean> {
    const parsed = parseQuery(z.object({ name: requiredText(128), id: optionalQueryId }), query);
    return this.menus.nameExists(parsed.name, parsed.id);
  }

  @Get('path-exists')
  @RequirePermissions('System:Menu:List')
  async pathExists(@Query() query: unknown): Promise<boolean> {
    const parsed = parseQuery(z.object({ path: z.string().max(255), id: optionalQueryId }), query);
    return this.menus.pathExists(parsed.path, parsed.id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('System:Menu:Create')
  async create(@Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.menus.create(parseMenuBody(body), actor);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermissions('System:Menu:Update')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.menus.update(
      parseRequest(uuidSchema, id),
      parseRequest(menuBodySchema.extend({ version: editVersionSchema }), body),
      actor,
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('System:Menu:Delete')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.menus.remove(parseRequest(uuidSchema, id), actor);
  }
}
