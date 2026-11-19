import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
import { DateOnly } from '../common/dto/fields';
import {
  WhConfirmState,
  WhDieAction,
  WhDieBatchStatus,
  WhDieKind,
  WhDieOwner,
  WhDieStatus,
  WhOrientation,
  WhPartnerKind,
  WhSlipKind,
  WhSlipStatus,
  WhWarehouseKind,
} from '../generated/prisma/enums';

// ───────────── Danh mục ─────────────

export class PartnerInputDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;
  @IsEnum(WhPartnerKind)
  kind: WhPartnerKind;
  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class PartnerDto {
  id: string;
  name: string;
  @ApiProperty({ enum: WhPartnerKind, enumName: 'WhPartnerKind' })
  kind: WhPartnerKind;
  phone: string | null;
  note: string | null;
  isActive: boolean;
  /** Khuôn đang ở đối tác này */
  diesHeld: number;
}

export class LocationInputDto {
  /** Kho khuôn có kệ này */
  @IsUUID()
  warehouseId: string;
  /** Ví dụ "T4-K02-O03" hoặc "Tầng 4" */
  @IsString() @IsNotEmpty() @MaxLength(40)
  code: string;
  @IsOptional() @IsString() @MaxLength(200)
  note?: string | null;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class LocationDto {
  id: string;
  warehouseId: string;
  warehouseName: string;
  code: string;
  note: string | null;
  isActive: boolean;
  dies: number;
}

export class SymbolInputDto {
  @IsString() @Matches(/^[A-Z]{2,5}$/, { message: 'Ký hiệu là 2–5 chữ in hoa' })
  code: string;
  @IsString() @IsNotEmpty() @MaxLength(60)
  name: string;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class SymbolDto {
  code: string;
  name: string;
  isActive: boolean;
  lastNo: number;
  dies: number;
}

// ───────────── Kho ─────────────

export class WarehouseInputDto {
  /** Mã kho dùng trong số phiếu: GIAY, BAT, OFFSET… */
  @IsString() @Matches(/^[A-Z0-9]{2,10}$/, { message: 'Mã kho là 2–10 chữ in hoa hoặc số' })
  code: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;
  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;
  /** Chỉ đặt khi tạo kho */
  @IsOptional() @IsEnum(WhWarehouseKind)
  kind?: WhWarehouseKind;
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  sortOrder?: number;
  /** Thủ kho: người xác nhận phiếu của kho này */
  @IsArray() @IsUUID('all', { each: true })
  keeperIds: string[];
}

export class KeeperDto {
  id: string;
  fullName: string;
}

export class WarehouseDto {
  id: string;
  code: string;
  name: string;
  address: string | null;
  @ApiProperty({ enum: WhWarehouseKind, enumName: 'WhWarehouseKind' })
  kind: WhWarehouseKind;
  note: string | null;
  isActive: boolean;
  sortOrder: number;
  keepers: KeeperDto[];
  /** Số vật tư có ở kho */
  materials: number;
  /** Khuôn đang ở kho (kho khuôn) */
  dies: number;
  /** Người đang xem xác nhận được phiếu của kho này */
  canConfirm: boolean;
  /** Phiếu đang chờ xác nhận */
  pending: number;
  /** Quy cách dưới mức tối thiểu */
  low: number;
}

// ───────────── Vật tư, quy cách, đơn vị tính ─────────────

export class SpecInputDto {
  @IsOptional() @IsString() @IsUUID()
  id?: string;
  /** cm; 0 x 0 khi vật tư không theo khổ; dài 0 = chỉ có khổ rộng (cuộn) */
  @IsNumber() @Min(0) @Max(100_000)
  widthCm: number;
  @IsNumber() @Min(0) @Max(100_000)
  lengthCm: number;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UnitInputDto {
  @IsOptional() @IsString() @IsUUID()
  id?: string;
  @IsString() @IsNotEmpty() @MaxLength(20)
  name: string;
  /** 1 đơn vị này = factor đơn vị cơ sở */
  @IsNumber() @Min(0.0001) @Max(100_000_000)
  factor: number;
  /** Hệ số riêng cho một quy cách (khổ); bỏ trống = áp dụng mọi quy cách */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0)
  widthCm?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0)
  lengthCm?: number | null;
}

export class WhMaterialInputDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40)
  code?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(60)
  group: string;
  @IsString() @IsNotEmpty() @MaxLength(160)
  name: string;
  /** Đơn vị cơ sở: tồn lưu theo đơn vị này */
  @IsString() @IsNotEmpty() @MaxLength(20)
  unit: string;
  @IsBoolean()
  hasSizes: boolean;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
  /** Quy cách (khổ); vật tư không theo khổ để trống */
  @IsArray() @ValidateNested({ each: true }) @Type(() => SpecInputDto)
  specs: SpecInputDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => UnitInputDto)
  units: UnitInputDto[];
  /** Kho có vật tư này */
  @IsArray() @IsUUID('all', { each: true })
  warehouseIds: string[];
}

export class SpecDto {
  id: string;
  widthCm: number;
  lengthCm: number;
  /** "18 x 50,5" / "khổ 160" / "" */
  label: string;
  isActive: boolean;
}

export class UnitDto {
  id: string;
  name: string;
  factor: number;
  specId: string | null;
  specLabel: string | null;
}

export class MaterialStockDto {
  warehouseId: string;
  warehouseCode: string;
  qty: number;
}

export class WhMaterialDto {
  id: string;
  code: string | null;
  group: string;
  name: string;
  unit: string;
  hasSizes: boolean;
  isActive: boolean;
  specs: SpecDto[];
  units: UnitDto[];
  warehouseIds: string[];
  /** Tổng tồn theo kho (đơn vị cơ sở) */
  stocks: MaterialStockDto[];
}

// ───────────── Tồn kho ─────────────

export class StockUnitDto {
  /** null = đơn vị cơ sở */
  id: string | null;
  name: string;
  factor: number;
}

export class StockItemDto {
  /** Dòng tồn: một quy cách tại một kho */
  id: string;
  warehouseId: string;
  warehouseCode: string;
  specId: string;
  materialId: string;
  materialCode: string | null;
  group: string;
  materialName: string;
  /** Đơn vị cơ sở */
  unit: string;
  hasSizes: boolean;
  widthCm: number;
  lengthCm: number;
  /** "Giấy ngoại IC 145 · 18 x 50,5" */
  label: string;
  qty: number;
  minQty: number | null;
  low: boolean;
  isActive: boolean;
  /** Đang chờ xuất (phiếu xuất / chuyển đi chưa xác nhận) */
  pendingOut: number;
  /** Giá trị tồn tham khảo (bình quân các lần nhập có giá) */
  valueVnd: number | null;
  /** Đơn vị chọn được khi lập phiếu (đơn vị cơ sở đầu tiên) */
  units: StockUnitDto[];
}

export class StockQueryDto {
  @IsOptional() @IsUUID()
  warehouseId?: string;
  @IsOptional() @IsIn(['true', 'false'])
  all?: 'true' | 'false';
}

export class StockUpdateDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0)
  minQty?: number | null;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ───────────── Phiếu kho ─────────────

export class SlipLineInputDto {
  @IsUUID()
  specId: string;
  /** Đơn vị đã ghi; bỏ trống = đơn vị cơ sở */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  unitId?: string | null;
  @IsNumber() @Min(0.001) @Max(100_000_000)
  qty: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0)
  unitPriceVnd?: number | null;
}

export class SlipInputDto {
  @IsUUID()
  warehouseId: string;
  @IsIn(['RECEIPT', 'ISSUE', 'RETURN'])
  kind: 'RECEIPT' | 'ISSUE' | 'RETURN';
  @DateOnly()
  date: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  partnerId?: string | null;
  @IsOptional() @IsString() @MaxLength(120)
  receiver?: string | null;
  @IsOptional() @IsString() @MaxLength(200)
  purpose?: string | null;
  /** Số lệnh / đơn tham chiếu, gõ tay */
  @IsOptional() @IsString() @MaxLength(60)
  reference?: string | null;
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
  @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SlipLineInputDto)
  lines: SlipLineInputDto[];
  /** Người lập là thủ kho của kho: xác nhận luôn */
  @IsOptional() @IsBoolean()
  confirm?: boolean;
}

export class TransferInputDto {
  @IsUUID()
  fromWarehouseId: string;
  @IsUUID()
  toWarehouseId: string;
  @DateOnly()
  date: string;
  @IsOptional() @IsString() @MaxLength(120)
  receiver?: string | null;
  @IsOptional() @IsString() @MaxLength(60)
  reference?: string | null;
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
  @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SlipLineInputDto)
  lines: SlipLineInputDto[];
  /** Người lập là thủ kho kho đi: xác nhận xuất luôn */
  @IsOptional() @IsBoolean()
  confirm?: boolean;
}

export class VoidDto {
  @IsString() @IsNotEmpty() @MaxLength(300)
  reason: string;
}

export class SlipQueryDto {
  @IsOptional() @IsUUID()
  warehouseId?: string;
  @IsOptional() @IsEnum(WhSlipKind)
  kind?: WhSlipKind;
  @IsOptional() @IsEnum(WhSlipStatus)
  status?: WhSlipStatus;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
  @IsOptional() @DateOnly()
  from?: string;
  @IsOptional() @DateOnly()
  to?: string;
  @IsOptional() @IsString() @MaxLength(60)
  q?: string;
}

export class SlipLineDto {
  id: string;
  specId: string;
  label: string;
  /** Đơn vị cơ sở */
  unit: string;
  /** Theo đơn vị cơ sở */
  qty: number;
  /** Đơn vị đã ghi (null = đơn vị cơ sở) */
  unitName: string | null;
  unitQty: number | null;
  unitPriceVnd: number | null;
}

export class SlipRefDto {
  id: string;
  code: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  @ApiProperty({ enum: WhSlipStatus, enumName: 'WhSlipStatus' })
  status: WhSlipStatus;
}

export class SlipDto {
  id: string;
  code: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  @ApiProperty({ enum: WhSlipKind, enumName: 'WhSlipKind' })
  kind: WhSlipKind;
  @ApiProperty({ enum: WhSlipStatus, enumName: 'WhSlipStatus' })
  status: WhSlipStatus;
  date: string;
  partnerId: string | null;
  partnerName: string | null;
  receiver: string | null;
  purpose: string | null;
  reference: string | null;
  note: string | null;
  createdById: string;
  createdBy: string;
  createdAt: Date;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  rejectReason: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  /** Phiếu chuyển kho: phiếu ở kho bên kia */
  counterpart: SlipRefDto | null;
  /** Người đang xem xác nhận / từ chối được */
  canConfirm: boolean;
  /** Người đang xem huỷ được (phiếu chưa xác nhận) */
  canCancel: boolean;
  lines: SlipLineDto[];
}

export class CardRowDto {
  date: string;
  slipId: string;
  code: string;
  @ApiProperty({ enum: WhSlipKind, enumName: 'WhSlipKind' })
  kind: WhSlipKind;
  partyText: string | null;
  reference: string | null;
  inQty: number;
  outQty: number;
  balance: number;
}

export class StockCardDto {
  item: StockItemDto;
  rows: CardRowDto[];
}

// ───────────── Báo cáo: nhập – xuất – tồn, tồn theo ngày ─────────────

export class StockReportQueryDto {
  @IsUUID()
  warehouseId: string;
  @DateOnly()
  from: string;
  @DateOnly()
  to: string;
}

export class StockReportRowDto {
  stockId: string;
  specId: string;
  group: string;
  label: string;
  unit: string;
  opening: number;
  inQty: number;
  outQty: number;
  closing: number;
}

export class StockReportDto {
  warehouseId: string;
  from: string;
  to: string;
  rows: StockReportRowDto[];
}

export class SnapshotRunDto {
  days: number;
  rows: number;
}

export class StockAsOfQueryDto {
  @IsUUID()
  warehouseId: string;
  @DateOnly()
  date: string;
}

export class StockAsOfRowDto {
  stockId: string;
  specId: string;
  group: string;
  label: string;
  unit: string;
  /** Theo bản chụp cuối ngày nếu có, nếu không thì tính từ phiếu */
  qty: number;
  /** Tính lại từ phiếu hiện có (khác bản chụp khi có phiếu bổ sung về sau) */
  liveQty: number;
}

export class StockAsOfDto {
  warehouseId: string;
  date: string;
  @ApiProperty({ enum: ['SNAPSHOT', 'LIVE'] })
  source: 'SNAPSHOT' | 'LIVE';
  /** Lúc chụp (bản chụp cuối ngày) */
  takenAt: Date | null;
  rows: StockAsOfRowDto[];
}

// ───────────── Khuôn ─────────────

export class DieInputDto {
  /** Chỉ khi tạo mới */
  @IsOptional() @IsString() @Matches(/^[A-Z]{2,5}$/)
  symbolCode?: string;
  @IsOptional() @IsEnum(WhDieKind)
  kind?: WhDieKind;
  @IsString() @IsNotEmpty() @MaxLength(200)
  productName: string;
  @IsOptional() @IsString() @MaxLength(160)
  customerName?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(1000)
  lengthCm?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(1000)
  widthCm?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(1000)
  heightCm?: number | null;
  @IsOptional() @IsString() @MaxLength(120)
  sizeText?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEnum(WhOrientation)
  orientation?: WhOrientation | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(99)
  pieces?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(999)
  ups?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  makerId?: string | null;
  @IsOptional() @IsEnum(WhDieOwner)
  owner?: WhDieOwner;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0)
  costVnd?: number | null;
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;
  /** Chỉ khi tạo mới, bắt buộc một trong hai: khuôn làm xong nhập kho nào, hoặc giao thẳng tới xưởng nào */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  toWarehouseId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  toPartnerId?: string | null;
  /** Kệ cất khi nhận (kho) */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  toLocationId?: string | null;
  /** Lệnh bế khi giao thẳng tới xưởng */
  @IsOptional() @IsString() @MaxLength(60)
  reference?: string | null;
  /** Thủ kho xác nhận luôn (đã nhận / đã giao) */
  @IsOptional() @IsBoolean()
  confirm?: boolean;
  /** Bỏ qua cảnh báo trùng kích thước */
  @IsOptional() @IsBoolean()
  force?: boolean;
  /** Đánh dấu đã xử lý xong việc cần xác nhận */
  @IsOptional() @IsBoolean()
  reviewed?: boolean;
}

export const DIE_ACTIONS = ['KEEP', 'PASS', 'DEFECT', 'DISPOSE', 'MOVE', 'REUSE'] as const;
export type DieMoveAction = (typeof DIE_ACTIONS)[number];

/** Thao tác tại chỗ (khuôn không đổi nơi). Đổi nơi thì lập phiếu giao nhận. */
export class DieActionDto {
  @IsIn(DIE_ACTIONS)
  action: DieMoveAction;
  @DateOnly()
  date: string;
  /** Kệ trong kho (kiểm đạt, đổi kệ) */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  locationId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @DateOnly()
  expectedBackOn?: string | null;
  /** Lệnh bế (bắt buộc khi bế lệnh mới tại xưởng) */
  @IsOptional() @IsString() @MaxLength(60)
  reference?: string | null;
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
  /** Phát hiện lỗi: hỏng hẳn, không sửa được */
  @IsOptional() @IsBoolean()
  broken?: boolean;
}

export class DieQueryDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;
  @IsOptional() @IsEnum(WhDieStatus)
  status?: WhDieStatus;
  @IsOptional() @IsString()
  symbol?: string;
  /** "k:<id kho>", "x:<id xưởng>" hoặc "transit" (đang chuyển / khuôn mới chờ nhận) */
  @IsOptional() @Matches(/^(transit|[kx]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  place?: string;
  @IsOptional() @IsIn(['overdue', 'review', 'out'])
  flag?: 'overdue' | 'review' | 'out';
  /** Tìm theo kích thước, lệch tối đa `tol` cm mỗi chiều */
  @IsOptional() @Type(() => Number) @IsNumber()
  l?: number;
  @IsOptional() @Type(() => Number) @IsNumber()
  w?: number;
  @IsOptional() @Type(() => Number) @IsNumber()
  h?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5)
  tol?: number;
}

export class DieRowDto {
  id: string;
  code: string;
  symbolCode: string;
  @ApiProperty({ enum: WhDieKind, enumName: 'WhDieKind' })
  kind: WhDieKind;
  productName: string;
  customerName: string | null;
  size: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  @ApiProperty({ enum: WhOrientation, enumName: 'WhOrientation', nullable: true })
  orientation: WhOrientation | null;
  pieces: number | null;
  ups: number | null;
  @ApiProperty({ enum: WhDieStatus, enumName: 'WhDieStatus' })
  status: WhDieStatus;
  /** "Kho khuôn Âu Việt · T4-K02", tên xưởng, hoặc "A → B" khi đang chuyển */
  place: string;
  /** Kho quản lý (khuôn ở kho này khi holderId trống) */
  warehouseId: string;
  warehouseName: string;
  holderId: string | null;
  locationId: string | null;
  /** Phiếu giao nhận đang chờ xác nhận */
  pendingBatchId: string | null;
  expectedBackOn: string | null;
  overdue: boolean;
  needsReview: boolean;
  reviewNote: string | null;
}

export class DieMoveDto {
  id: string;
  @ApiProperty({ enum: WhDieAction, enumName: 'WhDieAction' })
  action: WhDieAction;
  actionLabel: string;
  date: string;
  @ApiProperty({ enum: WhDieStatus, enumName: 'WhDieStatus', nullable: true })
  toStatus: WhDieStatus | null;
  fromPlace: string | null;
  place: string | null;
  reference: string | null;
  expectedBackOn: string | null;
  note: string | null;
  batchId: string | null;
  batchCode: string | null;
  user: string | null;
  createdAt: Date;
}

export class DieDto extends DieRowDto {
  makerId: string | null;
  makerName: string | null;
  @ApiProperty({ enum: WhDieOwner, enumName: 'WhDieOwner' })
  owner: WhDieOwner;
  sizeText: string | null;
  costVnd: number | null;
  note: string | null;
  hasPhoto: boolean;
  @ApiProperty({ enum: DIE_ACTIONS, isArray: true })
  allowedActions: DieMoveAction[];
  /** Phiếu giao nhận đang chờ, kèm quyền xác nhận của người đang xem */
  pending: BatchDto | null;
  /** Khuôn cùng ký hiệu, kích thước gần giống */
  similar: DieRowDto[];
  moves: DieMoveDto[];
}

export class DieListDto {
  items: DieRowDto[];
  total: number;
}

export class DuplicateWarningDto {
  code: 'DIE_SIMILAR_EXISTS';
  similar: DieRowDto[];
}

// ───────────── Giao nhận khuôn ─────────────

export class NewDieLineDto {
  @IsString() @Matches(/^[A-Z]{2,5}$/)
  symbolCode: string;
  @IsString() @IsNotEmpty() @MaxLength(200)
  productName: string;
  /** "24x24x12,5" hoặc chữ */
  @IsOptional() @IsString() @MaxLength(120)
  size?: string | null;
}

export class BatchInputDto {
  @DateOnly()
  date: string;
  /** Từ: một kho hoặc một xưởng */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  fromWarehouseId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  fromPartnerId?: string | null;
  /** Đến (bắt buộc): một kho hoặc một xưởng */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  toWarehouseId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  toPartnerId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  toLocationId?: string | null;
  @IsArray() @IsUUID('all', { each: true })
  dieIds: string[];
  /** Khuôn có sẵn trong kho đi nhưng chưa có mã: cấp mã khi lập phiếu */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => NewDieLineDto)
  newDies?: NewDieLineDto[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @DateOnly()
  expectedBackOn?: string | null;
  @IsOptional() @IsString() @MaxLength(60)
  reference?: string | null;
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
  /** Thủ kho xác nhận xuất luôn */
  @IsOptional() @IsBoolean()
  confirm?: boolean;
}

export class BatchQueryDto {
  /** mine = chờ người đang xem xác nhận; open = còn chờ; all */
  @IsOptional() @IsIn(['mine', 'open', 'all'])
  tab?: 'mine' | 'open' | 'all';
}

export class BatchReceiveDto {
  /** Kệ cất khuôn */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  locationId?: string | null;
}

export class BatchRejectDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class BatchDto {
  id: string;
  code: string;
  date: string;
  fromWarehouseId: string | null;
  fromPartnerId: string | null;
  toWarehouseId: string | null;
  toPartnerId: string | null;
  toLocationId: string | null;
  fromName: string;
  toName: string;
  @ApiProperty({ enum: WhDieBatchStatus, enumName: 'WhDieBatchStatus' })
  status: WhDieBatchStatus;
  @ApiProperty({ enum: WhConfirmState, enumName: 'WhConfirmState' })
  outState: WhConfirmState;
  @ApiProperty({ enum: WhConfirmState, enumName: 'WhConfirmState' })
  inState: WhConfirmState;
  isNew: boolean;
  reference: string | null;
  note: string | null;
  rejectReason: string | null;
  expectedBackOn: string | null;
  createdBy: string;
  createdAt: Date;
  outBy: string | null;
  outAt: Date | null;
  inBy: string | null;
  inAt: Date | null;
  /** "Chờ thủ kho Kho khuôn Âu Việt (Quỳnh) xác nhận xuất" */
  waitingFor: string | null;
  /** Kho có thủ kho xác nhận xuất */
  controlName: string | null;
  canSend: boolean;
  canReceive: boolean;
  canReject: boolean;
  canCancel: boolean;
  dies: DieRowDto[];
}

export class DieJournalQueryDto {
  @DateOnly()
  from: string;
  @DateOnly()
  to: string;
  @IsOptional() @IsEnum(WhDieAction)
  action?: WhDieAction;
  /** Tên kho hoặc xưởng (khớp nơi đi hoặc nơi đến) */
  @IsOptional() @IsString() @MaxLength(120)
  place?: string;
  @IsOptional() @IsUUID()
  userId?: string;
}

export class DieJournalRowDto {
  id: string;
  date: string;
  createdAt: Date;
  dieId: string;
  code: string;
  productName: string;
  @ApiProperty({ enum: WhDieAction, enumName: 'WhDieAction' })
  action: WhDieAction;
  actionLabel: string;
  fromPlace: string | null;
  place: string | null;
  reference: string | null;
  note: string | null;
  batchId: string | null;
  batchCode: string | null;
  user: string | null;
}

// ───────────── Tổng quan, nhập Excel ─────────────

export class DiePlaceDto {
  /** "k:<id>" hoặc "x:<id>", dùng làm bộ lọc Ở đâu */
  key: string;
  name: string;
  @ApiProperty({ enum: ['KHO', 'PARTNER'] })
  kind: 'KHO' | 'PARTNER';
  dies: number;
}

export class PlaceCountDto {
  holderId: string;
  name: string;
  inUse: number;
  kept: number;
  overdue: number;
}

export class WarehouseOverviewDto {
  warehouses: WarehouseDto[];
  lowStock: StockItemDto[];
  /** Phiếu chờ người đang xem xác nhận */
  toConfirm: SlipDto[];
  /** Hàng đang chuyển giữa các kho (đã xuất, kho nhận chưa xác nhận) */
  inTransit: SlipDto[];
  diesTotal: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  diesByStatus: Record<string, number>;
  atPartners: PlaceCountDto[];
  overdue: DieRowDto[];
  checking: DieRowDto[];
  needsReview: number;
  recentSlips: SlipDto[];
  /** Phiếu giao nhận khuôn chờ người đang xem xác nhận */
  dieToConfirm: BatchDto[];
  /** Khuôn đang chuyển giữa hai kho */
  dieInTransit: BatchDto[];
  /** Số khuôn ở từng kho / xưởng */
  diePlaces: DiePlaceDto[];
}

export class ImportIssueDto {
  code: string | null;
  row: number;
  message: string;
}

export class PaperImportItemDto {
  row: number;
  group: string;
  name: string;
  size: string;
  qty: number | null;
  note: string | null;
}

/** Nhập bảng tồn giấy: danh mục tạo thêm, phiếu điều chỉnh tồn đầu chờ thủ kho xác nhận */
export class PaperImportReportDto {
  sheet: string;
  /** Số dòng (loại giấy × khổ) đọc được */
  rows: number;
  materialsCreated: number;
  specsCreated: number;
  /** Số quy cách có số tồn đưa vào phiếu tồn đầu */
  counted: number;
  /** Quy cách đã có phiếu trên phần mềm, giữ tồn hiện tại */
  keptExisting: number;
  /** Phiếu điều chỉnh "Tồn đầu" đã lập, chờ xác nhận (null khi xem trước hoặc không có gì để ghi) */
  slipCode: string | null;
  totalQty: number;
  items: PaperImportItemDto[];
  issues: ImportIssueDto[];
}

export class ImportReportDto {
  dryRun: boolean;
  dies: number;
  skippedExisting: number;
  history: number;
  partnersCreated: string[];
  locationsCreated: string[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  byStatus: Record<string, number>;
  issues: ImportIssueDto[];
}
