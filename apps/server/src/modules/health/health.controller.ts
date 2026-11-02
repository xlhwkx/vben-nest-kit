import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/public.decorator";
import { HealthService } from "./health.service";

@ApiTags("Health")
@Public()
@SkipThrottle()
@Controller({ path: "health", version: [VERSION_NEUTRAL, "1"] })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: "Basic health (legacy)" })
  check() {
    return this.health.check();
  }

  @Get("live")
  @ApiOperation({ summary: "Liveness — process up, no dependency checks" })
  live() {
    return this.health.live();
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness — Postgres + Redis ping" })
  ready() {
    return this.health.ready();
  }
}
