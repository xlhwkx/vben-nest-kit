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
} from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../../common/decorators/require-permissions.decorator";
import {
  SystemMenuService,
  type SystemMenuInput,
} from "./system-menu.service";

const menuTypes = ["catalog", "menu", "button", "embedded", "link"] as const;

const menuBodySchema = z.object({
  name: z.string().min(1).max(128),
  path: z.string().max(255),
  type: z.enum(menuTypes),
  pid: z.union([z.string(), z.null()]).optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  authCode: z.union([z.string().max(128), z.null()]).optional(),
  component: z.union([z.string().max(255), z.null()]).optional(),
  redirect: z.union([z.string().max(255), z.null()]).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

function parseMenuBody(body: unknown): SystemMenuInput {
  const parsed = menuBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: "BadRequestException",
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const d = parsed.data;
  return {
    name: d.name,
    path: d.path,
    type: d.type,
    pid: d.pid,
    status: d.status,
    authCode: d.authCode,
    component: d.component,
    redirect: d.redirect,
    meta: d.meta,
  };
}

@Controller({ path: "system/menu", version: [VERSION_NEUTRAL, "1"] })
export class SystemMenuController {
  constructor(private readonly menus: SystemMenuService) {}

  /** list/exists: Bearer only (JwtAuthGuard); no write permission required */
  @Get("list")
  async list() {
    return this.menus.list();
  }

  @Get("name-exists")
  async nameExists(
    @Query("name") name?: string,
    @Query("id") id?: string,
  ): Promise<boolean> {
    if (!name?.trim()) {
      throw new BadRequestException({
        message: "BadRequestException",
        error: "name is required",
      });
    }
    return this.menus.nameExists(name, id);
  }

  @Get("path-exists")
  async pathExists(
    @Query("path") path?: string,
    @Query("id") id?: string,
  ): Promise<boolean> {
    if (path === undefined || path === null) {
      throw new BadRequestException({
        message: "BadRequestException",
        error: "path is required",
      });
    }
    return this.menus.pathExists(path, id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions("System:Menu:Create")
  async create(@Body() body: unknown) {
    return this.menus.create(parseMenuBody(body));
  }

  @Put(":id")
  @HttpCode(200)
  @RequirePermissions("System:Menu:Update")
  async update(@Param("id") id: string, @Body() body: unknown) {
    if (!id?.trim()) {
      throw new BadRequestException("id is required");
    }
    return this.menus.update(id, parseMenuBody(body));
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("System:Menu:Delete")
  async remove(@Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("id is required");
    }
    return this.menus.remove(id);
  }
}
