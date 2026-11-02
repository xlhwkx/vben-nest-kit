import { Module } from "@nestjs/common";
import { SystemMenuController } from "./menu/system-menu.controller";
import { SystemMenuService } from "./menu/system-menu.service";
import { SystemRoleController } from "./role/system-role.controller";
import { SystemRoleService } from "./role/system-role.service";
import { SystemUserController } from "./user/system-user.controller";
import { SystemUserService } from "./user/system-user.service";

@Module({
  controllers: [
    SystemMenuController,
    SystemRoleController,
    SystemUserController,
  ],
  providers: [SystemMenuService, SystemRoleService, SystemUserService],
  exports: [SystemMenuService, SystemRoleService, SystemUserService],
})
export class SystemModule {}