import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { WhCatalogService } from './catalog.service';
import { DiesService, WhFiles } from './dies.service';
import { DieImportService } from './import.service';
import { PaperImportService } from './paper-import.service';
import { StockService } from './stock.service';
import { WhSnapshotService } from './snapshot.service';
import { WarehousesService } from './warehouses.service';
import { WarehouseController } from './warehouse.controller';

/** Phân hệ Kho (M14). Danh mục riêng, không khoá ngoại sang bảng CRM hay kế toán. */
@Module({
  controllers: [WarehouseController],
  providers: [
    { provide: WhFiles, inject: [ENV], useFactory: (env: Env) => new WhFiles(join(env.CHAT_FILES_DIR, '..', 'warehouse')) },
    StockService,
    WarehousesService,
    WhSnapshotService,
    WhCatalogService,
    DiesService,
    DieImportService,
    PaperImportService,
  ],
})
export class WarehouseModule {}
