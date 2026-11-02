import { Controller, Get, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { TableService } from './table.service';

/** Demo table for Vben playground: GET /api/table/list */
@Controller({ path: 'table', version: [VERSION_NEUTRAL, '1'] })
export class TableController {
  constructor(private readonly tables: TableService) {}

  @Get('list')
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.tables.list({ page, pageSize, sortBy, sortOrder });
  }
}
