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
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../../../common/decorators/require-permissions.decorator";
import {
  SystemDeptService,
  type SystemDeptInput,
} from "./system-dept.service";

const deptBodySchema = z.object({
  name: z.string().min(1).max(128),
  pid: z.union([z.string(), z.number(), z.null()]).optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
});

function parseDeptBody(body: unknown): SystemDeptInput {
  const parsed = deptBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: "BadRequestException",
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const d = parsed.data;
  return {
    name: d.name,
    pid: d.pid,
    status: d.status,
    remark: d.remark,
  };
}

@Controller({ path: "system/dept", version: [VERSION_NEUTRAL, "1"] })
export class SystemDeptController {
  constructor(private readonly depts: SystemDeptService) {}

  /** list: Bearer only; tree, non-paginated */
  @Get("list")
  async list() {
    return this.depts.list();
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions("System:Dept:Create")
  async create(@Body() body: unknown) {
    return this.depts.create(parseDeptBody(body));
  }

  @Put(":id")
  @HttpCode(200)
  @RequirePermissions("System:Dept:Update")
  async update(@Param("id") id: string, @Body() body: unknown) {
    if (!id?.trim()) {
      throw new BadRequestException("id is required");
    }
    return this.depts.update(id, parseDeptBody(body));
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("System:Dept:Delete")
  async remove(@Param("id") id: string) {
    if (!id?.trim()) {
      throw new BadRequestException("id is required");
    }
    return this.depts.remove(id);
  }
}
