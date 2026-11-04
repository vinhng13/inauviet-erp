import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  Max,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OrderStatus, PaymentMethod } from '../generated/prisma/enums';
import { PageQueryDto } from '../common/dto/pagination.dto';
import { DateOnly, Vnd } from '../common/dto/fields';
import { CustomerDto } from '../customers/customers.dto';
import { DeliveryDto } from '../deliveries/deliveries.dto';
import { PaymentDto } from '../payments/payments.dto';
import { QuoteListItemDto } from '../quotes/quotes.dto';
import { DesignFeedback, Priority, ProductionStage } from '../generated/prisma/enums';
import { OrderAcceptanceDto, OrderDesignDto, OrderProductionDto } from './workflow.dto';

// ───────────── Input ─────────────

export class OrderLineInputDto {
  /** e.g. "Banner hiflex 2×1 m" */
  @IsString() @IsNotEmpty() @MaxLength(300)
  description: string;

  /** Material, finishing, print method */
  @IsOptional() @IsString() @MaxLength(1000)
  spec?: string;

  @IsInt() @Min(1)
  quantity: number;

  /** Optional unit price in đồng (price of one piece for lines priced per m²) */
  @IsOptional() @Vnd()
  unitPriceVnd?: number | null;

  /** Catalog product. With a product priced per m², send widthM/heightM: the piece price is computed on the server. */
  @IsOptional() @IsUUID()
  productId?: string | null;

  /** ĐVT (tấm, cái, bộ…) */
  @IsOptional() @IsString() @MaxLength(20)
  unit?: string | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100)
  widthM?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100)
  heightM?: number | null;

  /** Price per m² for catalog products priced per m² (defaults to the stored or catalog price) */
  @IsOptional() @Vnd()
  areaPriceVnd?: number | null;
}

export class PlanLineByIndexDto {
  /** Position of the line in `lines` (0-based) */
  @IsInt() @Min(0)
  lineIndex: number;

  @IsInt() @Min(1)
  plannedQty: number;
}

export class PlannedTripDto {
  @DateOnly()
  plannedDate: string;

  /** Defaults to the customer's address */
  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  @ValidateNested({ each: true }) @Type(() => PlanLineByIndexDto) @ArrayMinSize(1)
  lines: PlanLineByIndexDto[];
}

export class DepositDto {
  @Vnd(1)
  amountVnd: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** Defaults to the order date */
  @IsOptional() @DateOnly()
  paidOn?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class CreateOrderDto {
  @IsUUID()
  customerId: string;

  /** Defaults to today */
  @IsOptional() @DateOnly()
  orderDate?: string;

  @IsOptional() @DateOnly()
  dueDate?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ValidateNested({ each: true }) @Type(() => OrderLineInputDto) @ArrayMinSize(1)
  lines: OrderLineInputDto[];

  /** Delivery plan: one or more trips. Can also be added later. */
  @IsOptional() @ValidateNested({ each: true }) @Type(() => PlannedTripDto)
  deliveries?: PlannedTripDto[];

  /** Optional deposit received with the order */
  @IsOptional() @ValidateNested() @Type(() => DepositDto)
  deposit?: DepositDto;
}

export class UpdateOrderDto {
  @IsOptional() @DateOnly()
  orderDate?: string;

  /** Send null to clear */
  @IsOptional() @ValidateIf((_, v) => v !== null) @DateOnly()
  dueDate?: string | null;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class ReplaceLineDto extends OrderLineInputDto {
  /** Existing line id; omit for a new line */
  @IsOptional() @IsUUID()
  id?: string;
}

export class ReplaceLinesDto {
  /** The complete new list. Lines left out are removed (only allowed if they have no deliveries). */
  @ValidateNested({ each: true }) @Type(() => ReplaceLineDto) @ArrayMinSize(1)
  lines: ReplaceLineDto[];
}

export class CancelOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

const toBool = ({ value }: { value: unknown }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value);

export class OrderQueryDto extends PageQueryDto {
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus', required: false })
  @IsOptional() @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional() @IsUUID()
  customerId?: string;

  /** Due on or before this date */
  @IsOptional() @DateOnly()
  dueBefore?: string;

  /** Only orders with quantity not yet planned for delivery */
  @IsOptional() @Transform(toBool) @IsBoolean()
  hasUnplanned?: boolean;

  /** Only open orders past their due date */
  @IsOptional() @Transform(toBool) @IsBoolean()
  overdue?: boolean;
}

export class BoardQueryDto {
  /** Search by order code, customer name or phone */
  @IsOptional() @IsString()
  q?: string;

  /** week = due in the next 7 days, overdue = past due date */
  @ApiProperty({ enum: ['week', 'overdue'], required: false })
  @IsOptional() @IsString()
  due?: 'week' | 'overdue';

  @IsOptional() @Transform(toBool) @IsBoolean()
  hasUnplanned?: boolean;
}

// ───────────── Output ─────────────

export const PAYMENT_STATUSES = ['NONE', 'UNPAID', 'PARTLY_PAID', 'PAID'] as const;

export class OrderLineDto {
  id: string;
  /** Name shown everywhere, with the size for lines priced per m² ("Decal PP 1,2×0,8 m") */
  description: string;
  /** description without the size: send this back as `description` when editing a line priced per m² */
  baseName: string;
  productId: string | null;
  spec: string | null;
  unit: string | null;
  widthM: number | null;
  heightM: number | null;
  /** Price per m² for lines priced per m² */
  areaPriceVnd: number | null;
  quantity: number;
  /** Planned on scheduled trips plus already delivered */
  plannedQty: number;
  deliveredQty: number;
  /** quantity - plannedQty */
  unplannedQty: number;
  unitPriceVnd: number | null;
  lineTotalVnd: number | null;
  sortOrder: number;
}

export class OrderCardDto {
  id: string;
  /** DH-2610-0042 */
  code: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerPhone: string;
  @ApiProperty({ type: 'string', format: 'date' })
  orderDate: string;
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  dueDate: string | null;
  /** Open order past its due date */
  isOverdue: boolean;
  /** Short description of the lines, e.g. "Banner hiflex 2×1 m, Decal PP 30×40 cm" */
  summary: string;
  /** Trips not cancelled */
  tripsTotal: number;
  tripsDelivered: number;
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  nextPlannedDate: string | null;
  /** Total quantity not yet planned for delivery, across all lines */
  unplannedQty: number;
  totalVnd: number | null;
  paidVnd: number;
  @ApiProperty({ enum: PAYMENT_STATUSES, enumName: 'PaymentStatus' })
  paymentStatus: (typeof PAYMENT_STATUSES)[number];
  completedAt: string | null;
  /** null until step 2 is confirmed */
  needsDesign: boolean | null;
  designerName: string | null;
  lastDesignVersion: number | null;
  @ApiProperty({ enum: DesignFeedback, enumName: 'DesignFeedback', nullable: true })
  lastDesignFeedback: DesignFeedback | null;
  approvedVersion: number | null;
  approvalChannel: string | null;
  designFinalized: boolean;
  productionCode: string | null;
  @ApiProperty({ enum: ProductionStage, enumName: 'ProductionStage', nullable: true })
  productionStage: ProductionStage | null;
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  productionDueDate: string | null;
  @ApiProperty({ enum: Priority, enumName: 'Priority' })
  productionPriority: Priority;
  /** Every line delivered in full: waiting for the signed acceptance report */
  fullyDelivered: boolean;
  /** Quote the order was closed from */
  quote: OrderQuoteRefDto | null;
}

export class OrderQuoteRefDto {
  id: string;
  code: string;
}

export class OrderListDto {
  items: OrderCardDto[];
  total: number;
}

export class BoardColumnDto {
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;
  count: number;
  orders: OrderCardDto[];
}

export class BoardQuotesDto {
  count: number;
  /** Of which already sent to the customer */
  sentCount: number;
  items: QuoteListItemDto[];
}

export class BoardDto {
  /** Step 1: open quotes (DRAFT, SENT); null without quotes.view */
  quotes: BoardQuotesDto | null;
  /** Steps 2–6 and recently completed orders */
  columns: BoardColumnDto[];
  /** Completed orders are shown for this many days */
  completedDays: number;
}

export class QuoteChangeDto {
  /** CHANGED: product, size, quantity or price differs; ADDED: not on the quote; REMOVED: on the quote, dropped from the order */
  @ApiProperty({ enum: ['CHANGED', 'ADDED', 'REMOVED'] })
  kind: 'CHANGED' | 'ADDED' | 'REMOVED';
  /** Current name (quote name for REMOVED) */
  description: string;
  /** Quote name, when the product or size changed */
  fromDescription: string | null;
  fromQuantity: number | null;
  toQuantity: number | null;
  priceChanged: boolean;
  fromLineTotalVnd?: number | null;
  toLineTotalVnd?: number | null;
}

export class OrderQuoteDto {
  id: string;
  /** BG-2610-0012 */
  code: string;
  totalVnd?: number;
  /** What changed between the quote and the order (step 2: chốt báo giá) */
  changes: QuoteChangeDto[];
}

export class OrderDetailDto {
  id: string;
  code: string;
  /** Quote this order was closed from; null for orders entered directly */
  quote: OrderQuoteDto | null;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;
  @ApiProperty({ type: 'string', format: 'date' })
  orderDate: string;
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  dueDate: string | null;
  isOverdue: boolean;
  note: string | null;
  cancelReason: string | null;
  customer: CustomerDto;
  lines: OrderLineDto[];
  deliveries: DeliveryDto[];
  payments: PaymentDto[];
  unplannedQty: number;
  totalVnd: number | null;
  paidVnd: number;
  /** totalVnd - paidVnd; null when the order has no prices */
  balanceVnd: number | null;
  @ApiProperty({ enum: PAYMENT_STATUSES, enumName: 'PaymentStatus' })
  paymentStatus: (typeof PAYMENT_STATUSES)[number];
  productionStartedAt: string | null;
  /** Step 2 confirmed with the customer */
  confirmedAt: string | null;
  /** Chosen at step 2: true = design steps 3–4, false = customer files go straight to production */
  needsDesign: boolean | null;
  design: OrderDesignDto;
  production: OrderProductionDto | null;
  /** Every line delivered in full: the acceptance report can be signed */
  fullyDelivered: boolean;
  acceptance: OrderAcceptanceDto | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}
