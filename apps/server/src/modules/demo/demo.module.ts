import { Module } from '@nestjs/common';
import { BigintController } from './bigint.controller';
import { StatusController } from './status.controller';
import { TableController } from './table.controller';
import { TableService } from './table.service';
import { TimezoneController } from './timezone.controller';
import { TimezoneService } from './timezone.service';

@Module({
  controllers: [TableController, StatusController, TimezoneController, BigintController],
  providers: [TableService, TimezoneService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class DemoModule {}
