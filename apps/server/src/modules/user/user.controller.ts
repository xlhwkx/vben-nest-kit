import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import {
  CurrentUser,
  type AuthUser,
} from "../../common/decorators/current-user.decorator";
import { UserService } from "./user.service";

@Controller({ path: "user", version: [VERSION_NEUTRAL, "1"] })
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get("info")
  async info(@CurrentUser() user: AuthUser) {
    return this.users.getInfo(user.userId);
  }
}
