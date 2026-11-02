import { Controller, Get, Query, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { AuditService } from "./audit.service";

@ApiTags("Audit")
@ApiBearerAuth("Bearer")
@Controller({ path: "system/audit", version: [VERSION_NEUTRAL, "1"] })
export class SystemAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("list")
  @RequirePermissions("System:Audit:List")
  @ApiOperation({ summary: "分页查询审计日志（Nest-only）" })
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("username") username?: string,
    @Query("action") action?: string,
    @Query("module") module?: string,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
  ) {
    return this.audit.list({
      page,
      pageSize,
      username,
      action,
      module,
      startTime,
      endTime,
    });
  }
}
