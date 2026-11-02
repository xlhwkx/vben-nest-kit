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
  type DictDataInput,
} from "./system-dict.service";

const dataBodySchema = z.object({
  dictCode: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(128).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  color: z.union([z.string().max(64), z.null()]).optional(),
  remark: z.union([z.string().max(512), z.null()]).optional(),
  sort: z.number().optional(),
  status: z.union([z.literal(0), z.literal(1)]).optional(),
});

function parseDataBody(body: unknown, requireCreate: boolean): DictDataInput {
  const parsed = dataBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      message: "BadRequestException",
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const d = parsed.data;
  if (requireCreate) {
    if (!d.dictCode?.trim()) throw new BadRequestException("dictCode is required");
    if (!d.label?.trim()) throw new BadRequestException("label is required");
    if (d.value === undefined) throw new BadRequestException("value is required");
  }
  const out: DictDataInput = {};
  if (d.dictCode !== undefined) out.dictCode = d.dictCode;
  if (d.label !== undefined) out.label = d.label;
  if (d.value !== undefined) out.value = d.value;
  if (d.color !== undefined) out.color = d.color;
  if (d.remark !== undefined) out.remark = d.remark;
  if (d.sort !== undefined) out.sort = d.sort;
  if (d.status !== undefined) out.status = d.status;
  return out;
}

@Controller({ path: "system/dict/data", version: [VERSION_NEUTRAL, "1"] })
export class SystemDictDataController {
  constructor(private readonly dicts: SystemDictService) {}

  @Get("list")
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("dictCode") dictCode?: string,
    @Query("label") label?: string,
    @Query("status") status?: string,
  ) {
    return this.dicts.listData({ page, pageSize, dictCode, label, status });
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions("System:Dict:Create")
  async create(@Body() body: unknown) {
    return this.dicts.createData(parseDataBody(body, true));
  }

  @Put(":id")
  @HttpCode(200)
  @RequirePermissions("System:Dict:Update")
  async update(@Param("id") id: string, @Body() body: unknown) {
    if (!id?.trim()) throw new BadRequestException("id is required");
    return this.dicts.updateData(id, parseDataBody(body, false));
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions("System:Dict:Delete")
  async remove(@Param("id") id: string) {
    if (!id?.trim()) throw new BadRequestException("id is required");
    return this.dicts.deleteData(id);
  }
}
