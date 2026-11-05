import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  AccountQueryDto,
  AssetsDto,
  CashBookDto,
  CashBookQueryDto,
  CreateAssetDto,
  CreateCashPaymentDto,
  CreateIssueDto,
  CreateManualEntryDto,
  CreateReceiptDto,
  DebtsDto,
  GlDto,
  IdDto,
  JournalDto,
  LedgerAccountDto,
  MaterialDto,
  OpeningsDto,
  OverviewDto,
  PeriodsDto,
  PnlDto,
  ReopenPeriodDto,
  SaveCategoryDto,
  SaveMaterialDto,
  SaveOpeningsDto,
  SaveStockOpeningsDto,
  SaveSupplierDto,
  StartBooksDto,
  StepParamDto,
  StockDto,
  SupplierDto,
  TaxDto,
  UpdateEntryDto,
} from './accounting.dto';
import { ClosingService } from './closing.service';
import { QueriesService } from './queries.service';
import { VouchersService } from './vouchers.service';

/** Internal books (Thông tư 133): periods and month-end, vouchers, ledgers and reports. */
@ApiTags('accounting')
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly queries: QueriesService,
    private readonly vouchers: VouchersService,
    private readonly closing: ClosingService,
  ) {}

  // ───────────── Periods & month-end ─────────────

  @RequirePermission('accounting.view')
  @Get('accounts')
  accounts(): Promise<LedgerAccountDto[]> {
    return this.queries.accounts();
  }

  @RequirePermission('accounting.view')
  @Get('periods')
  periods(): Promise<PeriodsDto> {
    return this.queries.periods();
  }

  /** Start the books at a month (once) */
  @RequirePermission('accounting.close')
  @Post('periods/start')
  async start(@Body() dto: StartBooksDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    return { id: await this.vouchers.start(dto.month, actor) };
  }

  @RequirePermission('accounting.close')
  @HttpCode(200)
  @Post('periods/:id/steps/:step')
  async runStep(@Param() params: StepParamDto, @CurrentUser() actor: AuthUser): Promise<OverviewDto> {
    await this.vouchers.syncNow();
    await this.closing.runStep(params.id, params.step, actor);
    return this.queries.overview(params.id);
  }

  @RequirePermission('accounting.close')
  @HttpCode(200)
  @Post('periods/:id/close')
  async close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<OverviewDto> {
    await this.vouchers.syncNow();
    await this.closing.close(id, actor);
    return this.queries.overview(id);
  }

  @RequirePermission('accounting.reopen')
  @HttpCode(200)
  @Post('periods/:id/reopen')
  async reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenPeriodDto, @CurrentUser() actor: AuthUser): Promise<OverviewDto> {
    await this.closing.reopen(id, dto.reason, actor);
    return this.queries.overview(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/overview')
  overview(@Param('id', ParseUUIDPipe) id: string): Promise<OverviewDto> {
    return this.queries.overview(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/journal')
  journal(@Param('id', ParseUUIDPipe) id: string): Promise<JournalDto> {
    return this.queries.journal(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/cash')
  cash(@Param('id', ParseUUIDPipe) id: string, @Query() q: CashBookQueryDto): Promise<CashBookDto> {
    return this.queries.cashBook(id, q.account ?? 'all');
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/debts')
  debts(@Param('id', ParseUUIDPipe) id: string): Promise<DebtsDto> {
    return this.queries.debts(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/stock')
  stock(@Param('id', ParseUUIDPipe) id: string): Promise<StockDto> {
    return this.queries.stock(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/tax')
  tax(@Param('id', ParseUUIDPipe) id: string): Promise<TaxDto> {
    return this.queries.tax(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/assets')
  assets(@Param('id', ParseUUIDPipe) id: string): Promise<AssetsDto> {
    return this.queries.assets(id);
  }

  @RequirePermission('accounting.view')
  @Get('periods/:id/ledger')
  ledger(@Param('id', ParseUUIDPipe) id: string, @Query() q: AccountQueryDto): Promise<GlDto> {
    return this.queries.generalLedger(id, q.account);
  }

  @RequirePermission('accounting.view')
  @Get('reports/pnl')
  pnl(): Promise<PnlDto> {
    return this.queries.pnl();
  }

  // ───────────── First period ─────────────

  @RequirePermission('accounting.view')
  @Get('openings')
  openings(): Promise<OpeningsDto> {
    return this.queries.openings();
  }

  @RequirePermission('accounting.close')
  @Put('openings')
  async saveOpenings(@Body() dto: SaveOpeningsDto, @CurrentUser() actor: AuthUser): Promise<OpeningsDto> {
    await this.vouchers.saveOpenings(dto, actor);
    return this.queries.openings();
  }

  @RequirePermission('accounting.close')
  @Put('openings/stock')
  async saveStockOpenings(@Body() dto: SaveStockOpeningsDto, @CurrentUser() actor: AuthUser): Promise<OpeningsDto> {
    await this.vouchers.saveStockOpenings(dto, actor);
    return this.queries.openings();
  }

  // ───────────── Catalogs ─────────────

  @RequirePermission('accounting.view')
  @Get('suppliers')
  suppliers(): Promise<SupplierDto[]> {
    return this.queries.suppliers();
  }

  @RequirePermission('accounting.post')
  @Post('suppliers')
  async createSupplier(@Body() dto: SaveSupplierDto): Promise<IdDto> {
    return { id: await this.vouchers.saveSupplier(null, dto) };
  }

  @RequirePermission('accounting.post')
  @Put('suppliers/:id')
  async updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSupplierDto): Promise<IdDto> {
    return { id: await this.vouchers.saveSupplier(id, dto) };
  }

  @RequirePermission('accounting.view')
  @Get('materials')
  materials(): Promise<MaterialDto[]> {
    return this.queries.materials();
  }

  @RequirePermission('accounting.post')
  @Post('materials')
  async createMaterial(@Body() dto: SaveMaterialDto): Promise<IdDto> {
    return { id: await this.vouchers.saveMaterial(null, dto) };
  }

  @RequirePermission('accounting.post')
  @Put('materials/:id')
  async updateMaterial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveMaterialDto): Promise<IdDto> {
    return { id: await this.vouchers.saveMaterial(id, dto) };
  }

  @RequirePermission('accounting.close')
  @Post('categories')
  async createCategory(@Body() dto: SaveCategoryDto): Promise<IdDto> {
    return { id: await this.vouchers.saveCategory(null, dto) };
  }

  @RequirePermission('accounting.close')
  @Put('categories/:id')
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveCategoryDto): Promise<IdDto> {
    return { id: await this.vouchers.saveCategory(id, dto) };
  }

  // ───────────── Vouchers ─────────────

  /** Phiếu nhập kho: Dr 152 (+1331), Cr 111/112/331 */
  @RequirePermission('accounting.post')
  @Post('receipts')
  async createReceipt(@Body() dto: CreateReceiptDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    return { id: await this.vouchers.createReceipt(dto, actor) };
  }

  @RequirePermission('accounting.post')
  @HttpCode(204)
  @Delete('receipts/:id')
  deleteReceipt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    return this.vouchers.deleteReceipt(id, actor);
  }

  /** Phiếu xuất kho: Dr 154, Cr 152 at the provisional price; re-valued at month end */
  @RequirePermission('accounting.post')
  @Post('issues')
  async createIssue(@Body() dto: CreateIssueDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    return { id: await this.vouchers.createIssue(dto, actor) };
  }

  @RequirePermission('accounting.post')
  @HttpCode(204)
  @Delete('issues/:id')
  deleteIssue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    return this.vouchers.deleteIssue(id, actor);
  }

  /** Phiếu chi: an expense split by its category, or a payment to a supplier */
  @RequirePermission('accounting.post')
  @Post('cash-payments')
  async createCashPayment(@Body() dto: CreateCashPaymentDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    return { id: await this.vouchers.createCashPayment(dto, actor) };
  }

  @RequirePermission('accounting.post')
  @Post('assets')
  async createAsset(@Body() dto: CreateAssetDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    return { id: await this.vouchers.createAsset(dto, actor) };
  }

  @RequirePermission('accounting.post')
  @HttpCode(204)
  @Delete('assets/:id')
  deleteAsset(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    return this.vouchers.deleteAsset(id, actor);
  }

  /** Bút toán khác (PKT) */
  @RequirePermission('accounting.post')
  @Post('entries')
  async createEntry(@Body() dto: CreateManualEntryDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    return { id: await this.vouchers.createManualEntry(dto, actor) };
  }

  /** Change a manual entry, or an automatic one with a reason (the original lines are kept) */
  @RequirePermission('accounting.close')
  @Put('entries/:id')
  async updateEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEntryDto, @CurrentUser() actor: AuthUser): Promise<IdDto> {
    await this.vouchers.updateEntry(id, dto, actor);
    return { id };
  }

  /** Delete a manual entry or a voucher (receipt, issue, payment, asset purchase) with its entry */
  @RequirePermission('accounting.post')
  @HttpCode(204)
  @Delete('entries/:id')
  deleteEntry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    return this.vouchers.deleteEntry(id, actor);
  }
}
