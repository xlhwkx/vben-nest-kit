import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { SystemAuditController } from "./system-audit.controller";

@Global()
@Module({
  controllers: [SystemAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
