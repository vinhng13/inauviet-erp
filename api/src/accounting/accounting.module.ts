import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { BooksService } from './books.service';
import { ClosingService } from './closing.service';
import { FiguresService } from './figures.service';
import { QueriesService } from './queries.service';
import { CrmSyncService } from './sync.service';
import { VouchersService } from './vouchers.service';

@Module({
  controllers: [AccountingController],
  providers: [BooksService, FiguresService, CrmSyncService, ClosingService, VouchersService, QueriesService],
  exports: [CrmSyncService],
})
export class AccountingModule {}
