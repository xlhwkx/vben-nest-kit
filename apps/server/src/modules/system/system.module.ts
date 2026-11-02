import { Module } from "@nestjs/common";
import { SystemMenuController } from "./menu/system-menu.controller";
import { SystemMenuService } from "./menu/system-menu.service";
import { SystemRoleController } from "./role/system-role.controller";
import { SystemRoleService } from "./role/system-role.service";
import { SystemUserController } from "./user/system-user.controller";
import { SystemUserService } from "./user/system-user.service";
import { SystemDeptController } from "./dept/system-dept.controller";
import { SystemDeptService } from "./dept/system-dept.service";

@Module({
  controllers: [
    SystemMenuController,
    SystemRoleController,
    SystemUserController,
    SystemDeptController,
  ],
  providers: [
    SystemMenuService,
    SystemRoleService,
    SystemUserService,
    SystemDeptService,
  ],
  exports: [
    SystemMenuService,
    SystemRoleService,
    SystemUserService,
    SystemDeptService,
  ],
})
export class SystemModule {}