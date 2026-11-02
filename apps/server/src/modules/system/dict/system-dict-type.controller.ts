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
  SystemDictService,
  type DictTypeInput,
} from "./system-dict.service";

const typeBodySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  code: z.string().min(1).max(64).optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
});

function parseTypeBody(body: unknown, requireNameCode: boolean): DictTypeInput {
  const parsed = typeBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      message: "BadRequestException",
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const d = parsed.data;
  if (requireNameCode) {
    if (!d.name?.trim()) throw new BadRequestException("name is required");
    if (!d.code?.trim()) throw new BadRequestException("code is required");
  }
  const out: DictTypeInput = {};
  if (d.name !== undefined) out.name = d.name;
  if (d.code !== undefined) out.code = d.code;
  if (d.status !== undefined) out.status = d.status;
  if (d.remark !== undefined) out.remark = d.remark;
  return out;
}

@Controller({ path: "system/dict/type", version: [VERSION_NEUTRAL, "1"] })
export class SystemDictTypeController {
  constructor(private readonly dicts: SystemDictService) {}

  @Get("list")
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("name") name?: string,
    @Query("code") code?: string,
    @Query("status") status?: string,
  ) {
    return this.dicts.listTypes({ page, pageSize, name, code, status });
  }

  @Get("code-exists")
  async codeExists(@Query("code") code?: string, @Query("id") id?: string) {
    return this.dicts.codeExists(code, id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions("System:Dict:Create")
  async create(@Body() body: unknown) {
    return this.dicts.createType(parseTypeBody(body, true));
  }

  @Put(":id")
  @HttpCode(200)
  @RequirePermissions("System:Dict:Update")
  async update(@Param("id") id: string, @Body() body: unknown) {
    if (!id?.trim()) throw new BadRequestException("id is required");
    return this.dicts.updateType(id, parseTypeBody(body, false));
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("System:Dict:Delete")
  async remove(@Param("id") id: string) {
    if (!id?.trim()) throw new BadRequestException("id is required");
    return this.dicts.deleteType(id);
  }
}
