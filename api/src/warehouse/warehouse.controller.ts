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
import { StockService } from './stock.service';
import {
  BatchDto,
  BatchInputDto,
  CountCreateDto,
  CountDto,
  CountUpdateDto,
  DieActionDto,
  DieCountCreateDto,
  DieCountDto,
  DieCountMarkDto,
  DieDto,
  DieInputDto,
  DieListDto,
  DieQueryDto,
  ImportReportDto,
  LocationDto,
  LocationInputDto,
  WhMaterialDto,
  WhMaterialInputDto,
  MonthDto,
  MonthLockDto,
  PartnerDto,
  PartnerInputDto,
  SlipDto,
  SlipInputDto,
  SlipQueryDto,
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
  ) {}

  @RequirePermission('warehouse.view')
  @Get('overview')
  async overview(): Promise<WarehouseOverviewDto> {
    const [items, slips, parts] = await Promise.all([this.stock.items(), this.stock.slips({}), this.dies.overviewParts()]);
    return { lowStock: items.filter((i) => i.low), recentSlips: slips.slice(0, 8), ...parts };
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

  @RequirePermission('warehouse.view')
  @Get('month-locks')
  monthLocks(): Promise<MonthLockDto[]> {
    return this.catalog.monthLocks();
  }

  /** Chốt tồn tháng: phiếu trong tháng không lập / huỷ được nữa */
  @RequirePermission('warehouse.manage')
  @Post('month-locks')
  @HttpCode(204)
  lockMonth(@Body() dto: MonthDto, @CurrentUser() user: AuthUser): Promise<void> {
    return this.catalog.lockMonth(dto.month, user);
  }

  @RequirePermission('warehouse.manage')
  @Delete('month-locks/:month')
  @HttpCode(204)
  unlockMonth(@Param('month') month: string): Promise<void> {
    return this.catalog.unlockMonth(month);
  }

  // ───────────── Tồn kho và phiếu ─────────────

  @RequirePermission('warehouse.view')
  @Get('stock')
  @ApiQuery({ name: 'all', required: false, type: Boolean })
  items(@Query('all') all?: string): Promise<StockItemDto[]> {
    return this.stock.items(all === 'true');
  }

  @RequirePermission('warehouse.view')
  @Get('stock/:id/card')
  card(@Param('id', ParseUUIDPipe) id: string): Promise<StockCardDto> {
    return this.stock.card(id);
  }

  @RequirePermission('warehouse.view')
  @Get('slips')
  slips(@Query() q: SlipQueryDto): Promise<SlipDto[]> {
    return this.stock.slips(q);
  }

  @RequirePermission('warehouse.view')
  @Get('slips/:id')
  slip(@Param('id', ParseUUIDPipe) id: string): Promise<SlipDto> {
    return this.stock.slip(id);
  }

  @RequirePermission('warehouse.slip')
  @Post('slips')
  createSlip(@Body() dto: SlipInputDto, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.createSlip(dto, user);
  }

  @RequirePermission('warehouse.slip')
  @Post('slips/:id/void')
  voidSlip(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto, @CurrentUser() user: AuthUser): Promise<SlipDto> {
    return this.stock.voidSlip(id, dto.reason, user);
  }

  // ───────────── Kiểm kê vật tư ─────────────

  @RequirePermission('warehouse.view')
  @Get('counts')
  counts(): Promise<CountDto[]> {
    return this.stock.counts();
  }

  @RequirePermission('warehouse.view')
  @Get('counts/:id')
  count(@Param('id', ParseUUIDPipe) id: string): Promise<CountDto> {
    return this.stock.count(id);
  }

  @RequirePermission('warehouse.count')
  @Post('counts')
  createCount(@Body() dto: CountCreateDto, @CurrentUser() user: AuthUser): Promise<CountDto> {
    return this.stock.createCount(dto, user);
  }

  @RequirePermission('warehouse.count')
  @Put('counts/:id')
  updateCount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CountUpdateDto): Promise<CountDto> {
    return this.stock.updateCount(id, dto);
  }

  /** Duyệt: tạo phiếu điều chỉnh chênh lệch (cần quyền quản lý kho) */
  @RequirePermission('warehouse.manage')
  @Post('counts/:id/approve')
  approveCount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<CountDto> {
    return this.stock.approveCount(id, user);
  }

  @RequirePermission('warehouse.count')
  @Post('counts/:id/cancel')
  @HttpCode(204)
  cancelCount(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.stock.cancelCount(id);
  }

  // ───────────── Khuôn ─────────────

  @RequirePermission('warehouse.view')
  @Get('dies')
  dieList(@Query() q: DieQueryDto): Promise<DieListDto> {
    return this.dies.list(q);
  }

  @RequirePermission('warehouse.view')
  @Get('dies/:id')
  die(@Param('id', ParseUUIDPipe) id: string): Promise<DieDto> {
    return this.dies.get(id);
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importDies(@UploadedFile() file: Upload | undefined, @Query('dryRun') dryRun: string | undefined, @CurrentUser() user: AuthUser): Promise<ImportReportDto> {
    return this.importer.run(file?.buffer, dryRun !== 'false', user, this.dies.today());
  }

  // ───────────── Giao nhận nhiều khuôn ─────────────

  @RequirePermission('warehouse.view')
  @Get('batches')
  batches(): Promise<BatchDto[]> {
    return this.dies.batches();
  }

  @RequirePermission('warehouse.view')
  @Get('batches/:id')
  batch(@Param('id', ParseUUIDPipe) id: string): Promise<BatchDto> {
    return this.dies.batch(id);
  }

  @RequirePermission('warehouse.dies')
  @Post('batches')
  createBatch(@Body() dto: BatchInputDto, @CurrentUser() user: AuthUser): Promise<BatchDto> {
    return this.dies.createBatch(dto, user);
  }

  // ───────────── Kiểm kê khuôn ─────────────

  @RequirePermission('warehouse.view')
  @Get('die-counts')
  dieCounts(): Promise<DieCountDto[]> {
    return this.dies.dieCounts();
  }

  @RequirePermission('warehouse.view')
  @Get('die-counts/:id')
  dieCount(@Param('id', ParseUUIDPipe) id: string): Promise<DieCountDto> {
    return this.dies.dieCount(id);
  }

  @RequirePermission('warehouse.count')
  @Post('die-counts')
  createDieCount(@Body() dto: DieCountCreateDto, @CurrentUser() user: AuthUser): Promise<DieCountDto> {
    return this.dies.createDieCount(dto, user);
  }

  @RequirePermission('warehouse.count')
  @Post('die-counts/:id/marks')
  markDieCount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DieCountMarkDto): Promise<DieCountDto> {
    return this.dies.markDieCount(id, dto.die, dto.found);
  }

  @RequirePermission('warehouse.count')
  @Post('die-counts/:id/finish')
  finishDieCount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<DieCountDto> {
    return this.dies.finishDieCount(id, user);
  }
}
