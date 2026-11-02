import { Module } from "@nestjs/common";
import { SystemMenuController } from "./menu/system-menu.controller";
import { SystemMenuService } from "./menu/system-menu.service";

@Module({
  controllers: [SystemMenuController],
  providers: [SystemMenuService],
  exports: [SystemMenuService],
})
export class SystemModule {}
