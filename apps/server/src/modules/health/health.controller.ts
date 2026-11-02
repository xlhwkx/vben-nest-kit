import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { Public } from "../../common/decorators/public.decorator";

@Public()
@Controller({ path: "health", version: [VERSION_NEUTRAL, "1"] })
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      service: "qingzhan-server",
    };
  }
}
