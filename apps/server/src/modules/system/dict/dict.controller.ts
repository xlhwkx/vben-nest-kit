import { Controller, Get, Query, VERSION_NEUTRAL } from "@nestjs/common";
import { SystemDictService } from "./system-dict.service";

/** Frontend dict pull APIs: /api/dict/* and /api/v1/dict/* */
@Controller({ path: "dict", version: [VERSION_NEUTRAL, "1"] })
export class DictController {
  constructor(private readonly dicts: SystemDictService) {}

  @Get("all")
  async all() {
    return this.dicts.getAllEnabled();
  }

  @Get("data")
  async data(@Query("code") code?: string) {
    if (!code?.trim()) return [];
    return this.dicts.getEnabledByCode(code);
  }

  @Get("version")
  async version() {
    return this.dicts.getVersion();
  }
}
