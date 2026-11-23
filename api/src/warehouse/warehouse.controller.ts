import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { WhCatalogService } from './catalog.service';
import { DiesService } from './dies.service';
import { DieImportService } from './import.service';
import { PaperImportService } from './paper-import.service';
import { StockService } from './stock.service';
import { WhSnapshotService } from './snapshot.service';
import { WarehousesService } from './warehouses.service';
import {
  BatchDto,
  BatchInputDto,
  BatchQueryDto,
  BatchReceiveDto,
  BatchRejectDto,
  DieJournalQueryDto,
  DieJournalRowDto,
  DieActionDto,
  DieDto,
  DieInputDto,
  DieListDto,
  DieQueryDto,
  ImportReportDto,
  PaperImportReportDto,
  KeeperDto,
  LocationDto,
  LocationInputDto,
  WhMaterialDto,
  WhMaterialInputDto,
  PartnerDto,
  PartnerInputDto,
  SlipDto,
  SlipInputDto,
  SlipQueryDto,
  SnapshotRunDto,
  StockAsOfDto,
  StockAsOfQueryDto,
  StockQueryDto,
  StockReportDto,
  StockReportQueryDto,
  StockUpdateDto,
  TransferInputDto,
  WarehouseDto,
  WarehouseInputDto,
  StockCardDto,
  StockItemDto,
  SymbolDto,
  SymbolInputDto,
  VoidDto,
  WarehouseOverviewDto,
} from './warehouse.dto';

type Upload = { buffer: Buffer; mimetype: string; originalname: string };
const fileBody = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } };

/** Phân hệ Kho: vật tư (giấy, màng...) theo khổ và khuôn. Độc lập với CRM và kế toán. */
@ApiTags('warehouse')
@Controller('warehouse')
export class WarehouseController {
  constructor(
    private readonly catalog: WhCatalogService,
    private readonly stock: StockService,
    private readonly dies: DiesService,
    private readonly importer: DieImportService,
    private readonly paperImporter: PaperImportService,
    private readonly warehouses: WarehousesService,
    private readonly snapshots: WhSnapshotService,
  ) {}

  @RequirePermission('warehouse.view')
  @Get('overview')
  async overview(@CurrentUser() user: AuthUser): Promise<WarehouseOverviewDto> {
    const [warehouses, items, slips, pending, parts] = await Promise.all([
      this.warehouses.list(user, false),
      this.stock.items(),
      this.stock.slips({}, user),
      this.stock.slips({ status: 'PENDING' }, user),
      this.dies.overviewParts(user),
    ]);
    return {
      warehouses,
      lowStock: items.filter((i) => i.low),
      toConfirm: pending.filter((s) => s.canConfirm),
      inTransit: pending.filter((s) => s.kind === 'TRANSFER_IN' && s.counterpart?.status === 'CONFIRMED'),
      recentSlips: slips.filter((s) => s.status === 'CONFIRMED').slice(0, 8),
      ...parts,
    };
  }

  // ───────────── Kho ─────────────

  @RequirePermission('warehouse.view')
  @Get('warehouses')
  warehouseList(@CurrentUser() user: AuthUser): Promise<WarehouseDto[]> {
    return this.warehouses.list(user);
  }

  /** Người dùng để chọn làm thủ kho */
  @RequirePermission('warehouse.manage')
  @Get('people')
  people(): Promise<KeeperDto[]> {
    return this.warehouses.people();
  }

  @RequirePermission('warehouse.manage')
  @Post('warehouses')
  @HttpCode(204)
  createWarehouse(@Body() dto: WarehouseInputDto): Promise<void> {
    return this.warehouses.save(null, dto);
  }

  @RequirePermission('warehouse.manage')
  @Put('warehouses/:id')
  @HttpCode(204)
  updateWarehouse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WarehouseInputDto): Promise<void> {
    return this.warehouses.save(id, dto);
  }

  // ───────────── Danh mục ─────────────

  @RequirePermission('warehouse.view')
  @Get('partners')
  partners(): Promise<PartnerDto[]> {
    return this.catalog.partners();
  }

  @RequirePermission('warehouse.manage')
  @Post('partners')
  @HttpCode(204)
  createPartner(@Body() dto: PartnerInputDto): Promise<void> {
    return this.catalog.savePartner(null, dto);
  }

  @RequirePermission('warehouse.manage')
  @Put('partners/:id')
  @HttpCode(204)
  updatePartner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnerInputDto): Promise<void> {
    return this.catalog.savePartner(id, dto);
  }

  @RequirePermission('warehouse.view')
  @Get('locations')
  locations(): Promise<LocationDto[]> {
    return this.catalog.locations();
  }

  @RequirePermission('warehouse.manage')
  @Post('locations')
  @HttpCode(204)
  createLocation(@Body() dto: LocationInputDto): Promise<void> {
    return this.catalog.saveLocation(null, dto);
  }

  @RequirePermission('warehouse.manage')
  @Put('locations/:id')
  @HttpCode(204)
  updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LocationInputDto): Promise<void> {
    return this.catalog.saveLocation(id, dto);
  }

  @RequirePermission('warehouse.view')
  @Get('symbols')
  symbols(): Promise<SymbolDto[]> {
    return this.catalog.symbols();
  }

  @RequirePermission('warehouse.manage')
  @Put('symbols')
  @HttpCode(204)
  saveSymbol(@Body() dto: SymbolInputDto): Promise<void> {
    return this.catalog.saveSymbol(dto);
  }

  @RequirePermission('warehouse.view')
  @Get('materials')
  materials(): Promise<WhMaterialDto[]> {
    return this.catalog.materials();
  }

  @RequirePermission('warehouse.manage')
  @Post('materials')
  @HttpCode(204)
  createMaterial(@Body() dto: WhMaterialInputDto): Promise<void> {
    return this.catalog.saveMaterial(null, dto);
  }

  @RequirePermission('warehouse.manage')
  @Put('materials/:id')
  @HttpCode(204)
  updateMaterial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WhMaterialInputDto): Promise<void> {
    return this.catalog.saveMaterial(id, dto);
  }

  // ───────────── Tồn kho và phiếu ─────────────

  @RequirePermission('warehouse.view')
  @Get('stock')
  items(@Query() q: StockQueryDto): Promise<StockItemDto[]> {
    return this.stock.items(q.warehouseId, q.all === 'true');
  }

  /** Mức tối thiểu / ngừng dùng của một dòng tồn (một quy cách tại một kho) */
  @RequirePermission('warehouse.manage')
  @Put('stock/:id')
  @HttpCode(204)
  updateStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StockUpdateDto): Promise<void> {
    return this.stock.updateStock(id, dto);
  }

  @RequirePermission('warehouse.view')
  @Get('stock/:id/card')
  card(@Param('id', ParseUUIDPipe) id: string): Promise<StockCardDto> {
    return this.stock.card(id);
  }

  /** Nhập – xuất – tồn theo khoảng ngày */
  @RequirePermission('warehouse.view')
  @Get('reports/stock')
  report(@Query() q: StockReportQueryDto): Promise<StockReportDto> {
    return this.stock.report(q);
  }

  /** Tồn cuối một ngày: bản chụp nếu có, kèm số tính lại từ phiếu */
  @RequirePermission('warehouse.view')
  @Get('reports/as-of')
  asOf(@Query() q: StockAsOfQueryDto): Promise<StockAsOfDto> {
    return this.stock.asOf(q);
  }

  /** Chụp tồn cuối ngày cho các ngày đã qua còn thiếu (bình thường chạy tự động mỗi giờ) */
  @RequirePermission('warehouse.manage')
  @Post('snapshots/run')
  runSnapshots(): Promise<SnapshotRunDto> {
    return this.snapshots.run();
  }

  @RequirePermission('warehouse.view')
  @Get('slips')
  slips(@Query() q: SlipQueryDto, @CurrentUser() user: AuthUser): Promise<SlipDto[]> {
    return this.stock.slips(q, user);
  }

  @RequirePermission('warehouse.view')
  @Get('slips/:id')
  slip(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.slip(id, user);
  }

  /** Lập phiếu (chờ thủ kho xác nhận; thủ kho lập thì confirm=true để xác nhận luôn) */
  @RequirePermission('warehouse.slip')
  @Post('slips')
  createSlip(@Body() dto: SlipInputDto, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.createSlip(dto, user);
  }

  /** Phiếu chuyển kho A → B: thủ kho A xác nhận xuất, rồi thủ kho B xác nhận nhận */
  @RequirePermission('warehouse.slip')
  @Post('transfers')
  createTransfer(@Body() dto: TransferInputDto, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.createTransfer(dto, user);
  }

  @RequirePermission('warehouse.slip')
  @Post('slips/:id/confirm')
  confirmSlip(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.confirmSlip(id, user);
  }

  @RequirePermission('warehouse.slip')
  @Post('slips/:id/reject')
  rejectSlip(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.rejectSlip(id, dto.reason, user);
  }

  @RequirePermission('warehouse.slip')
  @Post('slips/:id/cancel')
  cancelSlip(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.cancelSlip(id, user);
  }

  @RequirePermission('warehouse.slip')
  @Post('slips/:id/void')
  voidSlip(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.voidSlip(id, dto.reason, user);
  }

  // ───────────── Kiểm kê vật tư ─────────────

  // ───────────── Khuôn ─────────────

  @RequirePermission('warehouse.view')
  @Get('dies')
  dieList(@Query() q: DieQueryDto): Promise<DieListDto> {
    return this.dies.list(q);
  }

  @RequirePermission('warehouse.view')
  @Get('dies/:id')
  die(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<DieDto> {
    return this.dies.get(id, user);
  }

  /** Mã khuôn cấp tự động theo ký hiệu. Khuôn gần trùng kích thước bị chặn (WH_DIE_SIMILAR_EXISTS) trừ khi force */
  @RequirePermission('warehouse.dies')
  @Post('dies')
  createDie(@Body() dto: DieInputDto, @CurrentUser() user: AuthUser): Promise<DieDto> {
    return this.dies.create(dto, user);
  }

  @RequirePermission('warehouse.dies')
  @Put('dies/:id')
  updateDie(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DieInputDto, @CurrentUser() user: AuthUser): Promise<DieDto> {
    return this.dies.update(id, dto, user);
  }

  /** Một bước luân chuyển (xuất, xưởng giữ, nhập lại, kiểm đạt, lỗi, sửa, thanh lý, đổi kệ) */
  @RequirePermission('warehouse.dies')
  @Post('dies/:id/actions')
  dieAction(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DieActionDto, @CurrentUser() user: AuthUser): Promise<DieDto> {
    return this.dies.action(id, dto, user);
  }

  @RequirePermission('warehouse.dies')
  @Post('dies/:id/photo')
  @HttpCode(204)
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  diePhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Upload | undefined): Promise<void> {
    return this.dies.savePhoto(id, file);
  }

  @ApiExcludeEndpoint()
  @RequirePermission('warehouse.view')
  @Get('dies/:id/photo')
  async photo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const path = await this.dies.photoPath(id);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.sendFile(path);
  }

  /** Nhập bảng khuôn Excel. dryRun=true chỉ xem trước, không ghi */
  @RequirePermission('warehouse.manage')
  @Post('dies/import')
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importDies(
    @UploadedFile() file: Upload | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<ImportReportDto> {
    return this.importer.run(file?.buffer, dryRun !== 'false', user, this.dies.today(), warehouseId);
  }

  /** Nhập tồn vật tư từ Excel vào một kho (warehouseId; mặc định Kho giấy): danh mục + phiếu điều chỉnh chờ xác nhận. dryRun=true chỉ xem trước */
  @RequirePermission('warehouse.manage')
  @Post('materials/import-paper')
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importPaper(
    @UploadedFile() file: Upload | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<PaperImportReportDto> {
    return this.paperImporter.run(file?.buffer, dryRun !== 'false', user, this.dies.today(), warehouseId);
  }

  // ───────────── Giao nhận khuôn ─────────────

  @RequirePermission('warehouse.view')
  @Get('batches')
  batches(@Query() q: BatchQueryDto, @CurrentUser() user: AuthUser): Promise<BatchDto[]> {
    return this.dies.batches(q, user);
  }

  @RequirePermission('warehouse.view')
  @Get('batches/:id')
  batch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<BatchDto> {
    return this.dies.batch(id, user);
  }

  /** Lập phiếu giao nhận: từ kho / xưởng tới kho / xưởng (bắt buộc nơi đến) */
  @RequirePermission('warehouse.dies')
  @Post('batches')
  createBatch(@Body() dto: BatchInputDto, @CurrentUser() user: AuthUser): Promise<BatchDto> {
    return this.dies.createBatch(dto, user);
  }

  /** Thủ kho kho đi xác nhận xuất */
  @RequirePermission('warehouse.dies')
  @Post('batches/:id/send')
  sendBatch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<BatchDto> {
    return this.dies.send(id, user);
  }

  /** Thủ kho kho nhận xác nhận đã nhận */
  @RequirePermission('warehouse.dies')
  @Post('batches/:id/receive')
  receiveBatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BatchReceiveDto, @CurrentUser() user: AuthUser): Promise<BatchDto> {
    return this.dies.receive(id, dto, user);
  }

  @RequirePermission('warehouse.dies')
  @Post('batches/:id/reject')
  @HttpCode(204)
  async rejectBatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BatchRejectDto, @CurrentUser() user: AuthUser): Promise<void> {
    await this.dies.close(id, 'REJECTED', dto.reason, user);
  }

  @RequirePermission('warehouse.dies')
  @Post('batches/:id/cancel')
  @HttpCode(204)
  async cancelBatch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.dies.close(id, 'CANCELLED', null, user);
  }

  /** Nhật ký khuôn: mọi thao tác trong khoảng ngày */
  @RequirePermission('warehouse.view')
  @Get('die-journal')
  dieJournal(@Query() q: DieJournalQueryDto): Promise<DieJournalRowDto[]> {
    return this.dies.journal(q);
  }

  // ───────────── Kiểm kê khuôn ─────────────
}
