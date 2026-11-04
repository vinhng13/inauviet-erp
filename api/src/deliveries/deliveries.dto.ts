import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryStatus, OrderStatus, PaymentMethod } from '../generated/prisma/enums';
import { PageQueryDto } from '../common/dto/pagination.dto';
import { DateOnly, Vnd } from '../common/dto/fields';

// ───────────── Input ─────────────

export class PlanLineDto {
  @IsUUID()
  orderLineId: string;

  @IsInt() @Min(1)
  plannedQty: number;
}

export class CreateDeliveryDto {
  @DateOnly()
  plannedDate: string;

  /** Defaults to the customer's address */
  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  @ValidateNested({ each: true }) @Type(() => PlanLineDto) @ArrayMinSize(1)
  lines: PlanLineDto[];
}

export class UpdateDeliveryDto {
  @IsOptional() @DateOnly()
  plannedDate?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  /** Replaces the trip's lines */
  @IsOptional() @ValidateNested({ each: true }) @Type(() => PlanLineDto) @ArrayMinSize(1)
  lines?: PlanLineDto[];
}

export class DeliverLineDto {
  @IsUUID()
  orderLineId: string;

  /** 0 up to the planned quantity. Anything less than planned returns to "not yet planned". */
  @IsInt() @Min(0)
  deliveredQty: number;
}

export class CollectPaymentDto {
  @Vnd(1)
  amountVnd: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class DeliverDto {
  /** ISO timestamp; defaults to now */
  @IsOptional() @IsISO8601()
  deliveredAt?: string;

  @IsOptional() @IsString() @MaxLength(200)
  receiverName?: string;

  /** Omit to deliver exactly what was planned */
  @IsOptional() @ValidateNested({ each: true }) @Type(() => DeliverLineDto)
  lines?: DeliverLineDto[];

  /** Money collected on this trip; recorded as a payment linked to it */
  @IsOptional() @ValidateNested() @Type(() => CollectPaymentDto)
  payment?: CollectPaymentDto;
}

export class CancelDeliveryDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

const toBool = ({ value }: { value: unknown }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value);

export class DeliveryQueryDto extends PageQueryDto {
  @ApiProperty({ enum: DeliveryStatus, enumName: 'DeliveryStatus', required: false })
  @IsOptional() @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  /** Planned on or after */
  @IsOptional() @DateOnly()
  from?: string;

  /** Planned on or before */
  @IsOptional() @DateOnly()
  to?: string;

  /** Scheduled trips planned before today */
  @IsOptional() @Transform(toBool) @IsBoolean()
  overdue?: boolean;
}

// ───────────── Output ─────────────

export class DeliveryLineDto {
  id: string;
  orderLineId: string;
  description: string;
  plannedQty: number;
  /** Set once the trip is delivered */
  deliveredQty: number | null;
}

export class DeliveryDto {
  id: string;
  /** GH-2610-0011 */
  code: string;
  orderId: string;
  @ApiProperty({ enum: DeliveryStatus, enumName: 'DeliveryStatus' })
  status: DeliveryStatus;
  @ApiProperty({ type: 'string', format: 'date' })
  plannedDate: string;
  /** Scheduled and planned before today */
  isOverdue: boolean;
  deliveredAt: string | null;
  address: string | null;
  receiverName: string | null;
  note: string | null;
  cancelReason: string | null;
  /** Value of the goods on this trip (delivered qty once delivered); null without prices */
  valueVnd: number | null;
  /** Payments collected on this trip */
  collectedVnd: number;
  lines: DeliveryLineDto[];
  createdAt: string;
}

export class DeliveryListItemDto extends DeliveryDto {
  orderCode: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  orderStatus: OrderStatus;
  customerName: string;
  customerPhone: string;
}

export class DeliveryListDto {
  items: DeliveryListItemDto[];
  total: number;
}
