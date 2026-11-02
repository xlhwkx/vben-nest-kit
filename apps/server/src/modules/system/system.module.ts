import { Module } from "@nestjs/common";
import { SystemMenuController } from "./menu/system-menu.controller";
import { SystemMenuService } from "./menu/system-menu.service";
import { SystemRoleController } from "./role/system-role.controller";
import { SystemRoleService } from "./role/system-role.service";

@Module({
  controllers: [SystemMenuController, SystemRoleController],
  providers: [SystemMenuService, SystemRoleService],
  exports: [SystemMenuService, SystemRoleService],
})
export class SystemModule {}
