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
  SystemUserService,
  type SystemUserCreateInput,
  type SystemUserUpdateInput,
} from "./system-user.service";

const createBodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6).max(128),
  name: z.string().min(1).max(128),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  gender: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  deptId: z.union([z.string().uuid(), z.null()]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
  homePath: z.union([z.string().max(255), z.null()]).optional(),
  avatar: z.union([z.string().max(512), z.null()]).optional(),
  roles: z.array(z.string()).optional(),
});

const updateBodySchema = z
  .object({
    username: z.string().min(1).max(64).optional(),
    password: z.string().min(6).max(128).optional(),
    name: z.string().min(1).max(128).optional(),
    status: z.union([z.literal(0), z.literal(1)]).optional(),
    gender: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    deptId: z.union([z.string().uuid(), z.null()]).optional(),
    remark: z.union([z.string().max(512), z.null()]).optional(),
    homePath: z.union([z.string().max(255), z.null()]).optional(),
    avatar: z.union([z.string().max(512), z.null()]).optional(),
    roles: z.array(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field is required",
  });

function parseCreateBody(body: unknown): SystemUserCreateInput {
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: "BadRequestException",
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const d = parsed.data;
  return {
    username: d.username,
    password: d.password,
    name: d.name,
    status: d.status,
    gender: d.gender,
    deptId: d.deptId,
    remark: d.remark,
    homePath: d.homePath,
    avatar: d.avatar,
    roles: d.roles,
  };
}

function parseUpdateBody(body: unknown): SystemUserUpdateInput {
  const parsed = updateBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: "BadRequestException",
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  return parsed.data;
}

@Controller({ path: "system/user", version: [VERSION_NEUTRAL, "1"] })
export class SystemUserController {
  constructor(private readonly users: SystemUserService) {}

  /** list: Bearer only; no write permission required */
  @Get("list")
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("name") name?: string,
    @Query("id") id?: string,
    @Query("remark") remark?: string,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
    @Query("status") status?: string,
    @Query("deptId") deptId?: string,
    @Query("gender") gender?: string,
  ) {
    return this.users.list({
      page,
      pageSize,
      name,
      id,
      remark,
      startTime,
      endTime,
      status,
      deptId,
      gender,
    });
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions("System:User:Create")
  async create(@Body() body: unknown) {
    return this.users.create(parseCreateBody(body));
  }

  @Put(":id")
  @HttpCode(200)
  @RequirePermissions("System:User:Update")
  async update(@Param("id") id: string, @Body() body: unknown) {
    if (!id?.trim()) {
      throw new BadRequestException("id is required");
    }
    return this.users.update(id, parseUpdateBody(body));
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("System:User:Delete")
  async remove(@Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("id is required");
    }
    return this.users.remove(id);
  }
}