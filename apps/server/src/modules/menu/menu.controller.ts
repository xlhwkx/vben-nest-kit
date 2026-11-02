import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import {
  CurrentUser,
  type AuthUser,
} from "../../common/decorators/current-user.decorator";
import { MenuService } from "./menu.service";

@Controller({ path: "menu", version: [VERSION_NEUTRAL, "1"] })
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  @Get("all")
  async all(@CurrentUser() user: AuthUser) {
    return this.menus.getAllForUser(user.userId);
  }
}
