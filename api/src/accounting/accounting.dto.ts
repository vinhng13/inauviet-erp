import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AssetKind, EntryKind, EntrySource, PayMethod, PeriodStatus } from '../generated/prisma/enums';
import { DateOnly, Vnd } from '../common/dto/fields';
import { STEPS, VAT_RATES, type Step } from './ledger';

const Month = () => Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '$property must be a month in YYYY-MM format' });

// ───────────── Inputs ─────────────

export class StartBooksDto {
  /** First month kept in the books, e.g. "2026-10" */
  @Month()
  month: string;
}

export class OpeningLineDto {
  @IsString() @IsNotEmpty()
  account: string;

  @Vnd()
  debitVnd: number;

  @Vnd()
  creditVnd: number;
}

export class SaveOpeningsDto {
  @ValidateNested({ each: true }) @Type(() => OpeningLineDto)
  lines: OpeningLineDto[];
}

export class StockOpeningLineDto {
  @IsUUID()
  materialId: string;

  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1e9)
  qty: number;

  @Vnd()
  priceVnd: number;
}

export class SaveStockOpeningsDto {
  @ValidateNested({ each: true }) @Type(() => StockOpeningLineDto)
  lines: StockOpeningLineDto[];
}

export class SaveSupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(30)
  taxCode?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class SaveMaterialDto {
  @IsString() @IsNotEmpty() @MaxLength(30)
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  @IsString() @IsNotEmpty() @MaxLength(20)
  unit: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class SplitPartDto {
  @IsIn(['154', '6421', '6422'])
  account: string;

  @IsNumber() @Min(0.01) @Max(100)
  percent: number;
}

export class SaveCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SplitPartDto)
  split: SplitPartDto[];

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ReceiptLineInputDto {
  @IsUUID()
  materialId: string;

  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1e9)
  qty: number;

  /** Unit price before VAT */
  @Vnd(1)
  priceVnd: number;
}

export class CreateReceiptDto {
  @DateOnly()
  date: string;

  @IsUUID()
  supplierId: string;

  @ApiProperty({ enum: PayMethod, enumName: 'PayMethod' })
  @IsEnum(PayMethod)
  payMethod: PayMethod;

  @IsIn(VAT_RATES)
  vatRate: number;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiptLineInputDto)
  lines: ReceiptLineInputDto[];
}

export class IssueLineInputDto {
  @IsUUID()
  materialId: string;

  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1e9)
  qty: number;
}

export class CreateIssueDto {
  @DateOnly()
  date: string;

  /** The order the materials go to (its work order) */
  @IsOptional() @IsUUID()
  orderId?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => IssueLineInputDto)
  lines: IssueLineInputDto[];
}

export class CreateCashPaymentDto {
  @DateOnly()
  date: string;

  @IsString() @IsNotEmpty() @MaxLength(300)
  description: string;

  /** An expense: its category (exactly one of categoryId / supplierId) */
  @ValidateIf((o: CreateCashPaymentDto) => !o.supplierId) @IsUUID()
  categoryId?: string;

  /** A payment to a supplier for what was bought on credit */
  @ValidateIf((o: CreateCashPaymentDto) => !o.categoryId) @IsUUID()
  supplierId?: string;

  /** Amount before VAT (the whole amount for a supplier payment) */
  @Vnd(1)
  amountVnd: number;

  /** VAT on an expense invoice; 0 when there is none */
  @IsIn(VAT_RATES)
  vatRate: number;

  @ApiProperty({ enum: ['CASH', 'BANK'] })
  @IsIn(['CASH', 'BANK'])
  method: 'CASH' | 'BANK';
}

export class AssetPurchaseDto {
  @DateOnly()
  date: string;

  @ApiProperty({ enum: PayMethod, enumName: 'PayMethod' })
  @IsEnum(PayMethod)
  method: PayMethod;

  @IsIn(VAT_RATES)
  vatRate: number;

  @IsOptional() @IsUUID()
  supplierId?: string;
}

export class CreateAssetDto {
  @ApiProperty({ enum: AssetKind, enumName: 'AssetKind' })
  @IsEnum(AssetKind)
  kind: AssetKind;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  /** Cost before VAT */
  @Vnd(1)
  costVnd: number;

  /** First month charged */
  @Month()
  startMonth: string;

  @IsInt() @Min(1) @Max(600)
  months: number;

  @IsIn(['154', '6421', '6422'])
  expenseAccount: string;

  /** Bought now: posts Dr 211 / 242 (+ 1331), Cr cash, bank or 331. Omitted: owned before the books started. */
  @IsOptional() @ValidateNested() @Type(() => AssetPurchaseDto)
  purchase?: AssetPurchaseDto;
}

export class EntryLineInputDto {
  @IsString() @IsNotEmpty()
  account: string;

  @Vnd()
  debitVnd: number;

  @Vnd()
  creditVnd: number;
}

export class CreateManualEntryDto {
  @DateOnly()
  date: string;

  @IsString() @IsNotEmpty() @MaxLength(300)
  description: string;

  @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => EntryLineInputDto)
  lines: EntryLineInputDto[];
}

export class UpdateEntryDto {
  @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => EntryLineInputDto)
  lines: EntryLineInputDto[];

  /** Manual entries only */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300)
  description?: string;

  /** Required when changing an automatic entry */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500)
  reason?: string;
}

export class ReopenPeriodDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class StepParamDto {
  @IsUUID()
  id: string;

  @ApiProperty({ enum: STEPS, enumName: 'ClosingStep' })
  @IsIn(STEPS)
  step: Step;
}

export class AccountQueryDto {
  @IsString() @IsNotEmpty()
  account: string;
}

export class CashBookQueryDto {
  @ApiProperty({ enum: ['all', '111', '112'], required: false })
  @IsOptional() @IsIn(['all', '111', '112'])
  account?: 'all' | '111' | '112';
}

// ───────────── Outputs ─────────────

export class IdDto {
  id: string;
}

export class LedgerAccountDto {
  code: string;
  name: string;
  isCredit: boolean;
}

export class PeriodDto {
  id: string;
  /** "2026-10" */
  month: string;
  @ApiProperty({ enum: PeriodStatus, enumName: 'PeriodStatus' })
  status: PeriodStatus;
  /** Month-end steps done, in order */
  @ApiProperty({ enum: STEPS, enumName: 'ClosingStep', isArray: true })
  stepsDone: Step[];
  closedAt: string | null;
  closedByName: string | null;
  /** Saved at closing, or worked out so far for an open month */
  revenueVnd: number;
  profitVnd: number;
  provisional: boolean;
  /** An earlier month is still open: steps and closing wait for it */
  previousOpen: boolean;
  /** First month of the books: openings can be edited */
  isFirst: boolean;
  canReopen: boolean;
}

export class StepStatusDto {
  @ApiProperty({ enum: STEPS, enumName: 'ClosingStep' })
  step: Step;
  done: boolean;
  doneAt: string | null;
  /** What the step will post or posted, e.g. "Khấu hao 4.250.000 đ · 4 tài sản" */
  summary: string;
  canRun: boolean;
}

export class OverviewKpiDto {
  cashVnd: number;
  bankVnd: number;
  receivableVnd: number;
  payableVnd: number;
  stockVnd: number;
  profitVnd: number;
}

export class PendingIssueDto {
  orderId: string;
  orderCode: string;
  productionCode: string | null;
  customerName: string;
  summary: string;
}

export class OverviewDto {
  period: PeriodDto;
  kpi: OverviewKpiDto;
  steps: StepStatusDto[];
  canClose: boolean;
  /** Orders in production or later with no materials issued yet */
  pendingIssues: PendingIssueDto[];
}

export class JournalLineDto {
  account: string;
  accountName: string;
  debitVnd: number;
  creditVnd: number;
}

export class JournalEntryDto {
  id: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  description: string;
  @ApiProperty({ enum: EntryKind, enumName: 'EntryKind' })
  kind: EntryKind;
  @ApiProperty({ enum: EntrySource, enumName: 'EntrySource' })
  source: EntrySource;
  edited: boolean;
  editReason: string | null;
  editedByName: string | null;
  /** Lines as first posted, for an automatic entry changed by hand */
  originalLines: JournalLineDto[] | null;
  note: string | null;
  orderCode: string | null;
  lines: JournalLineDto[];
  totalVnd: number;
  /** Open month, not a month-end entry */
  canEdit: boolean;
  canDelete: boolean;
}

export class TrialBalanceRowDto {
  account: string;
  name: string;
  openingVnd: number;
  debitVnd: number;
  creditVnd: number;
  closingVnd: number;
}

export class JournalDto {
  entries: JournalEntryDto[];
  /** Bảng cân đối số phát sinh: debit-positive balances */
  trialBalance: TrialBalanceRowDto[];
}

export class OpeningsDto {
  lines: TrialBalanceRowDto[];
  /** Σ debit − Σ credit: must be 0 */
  differenceVnd: number;
  editable: boolean;
}

export class CashRowDto {
  entryId: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  description: string;
  account: string;
  inVnd: number;
  outVnd: number;
  balanceVnd: number;
  orderCode: string | null;
}

export class CategorySumDto {
  id: string;
  name: string;
  split: SplitPartDto[];
  isActive: boolean;
  amountVnd: number;
}

export class CashBookDto {
  openingVnd: number;
  closingVnd: number;
  inVnd: number;
  outVnd: number;
  rows: CashRowDto[];
  categories: CategorySumDto[];
}

export class ReceivableRowDto {
  customerId: string | null;
  customerName: string;
  /** Owed by the customer (VAT included) */
  oweVnd: number;
  /** Paid in advance */
  advanceVnd: number;
  /** Oldest unpaid revenue date */
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  oldestDate: string | null;
  overdue30: boolean;
}

export class PayableRowDto {
  supplierId: string | null;
  supplierName: string;
  boughtVnd: number;
  paidVnd: number;
  balanceVnd: number;
}

export class DebtsDto {
  receivables: ReceivableRowDto[];
  payables: PayableRowDto[];
  receivableTotalVnd: number;
  payableTotalVnd: number;
}

export class StockRowDto {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  openQty: number;
  openPriceVnd: number;
  inQty: number;
  inVnd: number;
  outQty: number;
  outVnd: number;
  endQty: number;
  endVnd: number;
  /** Weighted average once priced, provisional price before */
  priceVnd: number;
  isActive: boolean;
}

export class ReceiptLineDto {
  materialId: string;
  materialName: string;
  unit: string;
  qty: number;
  priceVnd: number;
  valueVnd: number;
}

export class ReceiptDto {
  id: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  supplierId: string;
  supplierName: string;
  @ApiProperty({ enum: PayMethod, enumName: 'PayMethod' })
  payMethod: PayMethod;
  vatRate: number;
  valueVnd: number;
  vatVnd: number;
  note: string | null;
  lines: ReceiptLineDto[];
}

export class IssueDto {
  id: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  orderId: string | null;
  orderCode: string | null;
  customerName: string | null;
  valueVnd: number;
  note: string | null;
  lines: ReceiptLineDto[];
}

export class StockDto {
  priced: boolean;
  rows: StockRowDto[];
  receipts: ReceiptDto[];
  issues: IssueDto[];
  editable: boolean;
}

export class SupplierDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  taxCode: string | null;
  address: string | null;
  isActive: boolean;
}

export class MaterialDto {
  id: string;
  code: string;
  name: string;
  unit: string;
  isActive: boolean;
}

export class CashPaymentDto {
  id: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  description: string;
  categoryName: string | null;
  supplierName: string | null;
  amountVnd: number;
  vatVnd: number;
  method: string;
}

export class AssetRowDto {
  id: string;
  code: string;
  @ApiProperty({ enum: AssetKind, enumName: 'AssetKind' })
  kind: AssetKind;
  name: string;
  costVnd: number;
  startMonth: string;
  months: number;
  expenseAccount: string;
  /** Charge of the selected month */
  monthlyVnd: number;
  /** Charged through the selected month (this month counted once its step ran) */
  chargedVnd: number;
  remainingVnd: number;
  monthsCharged: number;
}

export class AssetsDto {
  assets: AssetRowDto[];
  tools: AssetRowDto[];
  depreciationVnd: number;
  allocationVnd: number;
}

export class TaxRowDto {
  entryId: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  description: string;
  baseVnd: number;
  vatVnd: number;
}

export class TaxDto {
  output: TaxRowDto[];
  input: TaxRowDto[];
  outputVnd: number;
  inputVnd: number;
  /** 1331 brought forward from earlier months */
  carriedInVnd: number;
  payableVnd: number;
  carryForwardVnd: number;
}

export class PnlColumnDto {
  label: string;
  provisional: boolean;
  revenueVnd: number;
  cogsVnd: number;
  sellingVnd: number;
  adminVnd: number;
  otherNetVnd: number;
  profitVnd: number;
}

export class PnlDto {
  columns: PnlColumnDto[];
}

export class GlRowDto {
  entryId: string;
  code: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  description: string;
  contra: string;
  debitVnd: number;
  creditVnd: number;
  balanceVnd: number;
}

export class GlDto {
  account: string;
  name: string;
  isCredit: boolean;
  openingVnd: number;
  debitVnd: number;
  creditVnd: number;
  closingVnd: number;
  rows: GlRowDto[];
  /** Accounts with an opening balance or a movement this month */
  usedAccounts: LedgerAccountDto[];
}

export class PeriodLogDto {
  id: string;
  action: string;
  text: string;
  userName: string | null;
  createdAt: string;
}

export class PeriodsDto {
  periods: PeriodDto[];
  log: PeriodLogDto[];
}
