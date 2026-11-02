import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';
import { TableController } from './table.controller';
import { TableService } from './table.service';

@Module({
  controllers: [TableController, StatusController],
  providers: [TableService],
})
export class DemoModule {}
