import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { OrderStatus, PaymentMethod } from '../generated/prisma/enums';
import { PageQueryDto } from '../common/dto/pagination.dto';
import { DateOnly, Vnd } from '../common/dto/fields';

export class CreatePaymentDto {
  @Vnd(1)
  amountVnd: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  /** Defaults to today */
  @IsOptional() @DateOnly()
  paidOn?: string;

  @IsOptional() @IsBoolean()
  isDeposit?: boolean;

  /** The trip this money was collected on (must belong to the same order) */
  @IsOptional() @IsUUID()
  deliveryId?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class VoidPaymentDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class PaymentDto {
  id: string;
  orderId: string;
  deliveryId: string | null;
  deliveryCode: string | null;
  amountVnd: number;
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;
  @ApiProperty({ type: 'string', format: 'date' })
  paidOn: string;
  isDeposit: boolean;
  note: string | null;
  recordedByName: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

const toBool = ({ value }: { value: unknown }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value);

export class PaymentQueryDto extends PageQueryDto {
  /** Paid on or after */
  @IsOptional() @DateOnly()
  from?: string;

  /** Paid on or before */
  @IsOptional() @DateOnly()
  to?: string;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod', required: false })
  @IsOptional() @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  /** Include voided payments (default false) */
  @IsOptional() @Transform(toBool) @IsBoolean()
  includeVoided?: boolean;
}

export class PaymentListItemDto extends PaymentDto {
  orderCode: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  orderStatus: OrderStatus;
  customerId: string;
  customerName: string;
}

export class PaymentListDto {
  items: PaymentListItemDto[];
  total: number;
  /** Sum of the matching payments that are not voided */
  sumVnd: number;
}

export class ReceivableQueryDto {
  /** Order code, customer name or phone */
  @IsOptional() @IsString()
  q?: string;

  /** Only orders with at least one delivered trip */
  @IsOptional() @Transform(toBool) @IsBoolean()
  deliveredOnly?: boolean;
}

export class ReceivableDto {
  orderId: string;
  orderCode: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  orderStatus: OrderStatus;
  customerId: string;
  customerName: string;
  customerPhone: string;
  @ApiProperty({ type: 'string', format: 'date' })
  orderDate: string;
  totalVnd: number;
  paidVnd: number;
  balanceVnd: number;
  /** At least one trip delivered: money is due now */
  delivered: boolean;
  /** Date of the first delivered trip */
  firstDeliveredAt: string | null;
}

export class ReceivableListDto {
  items: ReceivableDto[];
  /** Balance of orders already (partly) delivered */
  deliveredBalanceVnd: number;
  /** Balance of orders not delivered yet */
  upcomingBalanceVnd: number;
  /** Money received on open orders with nothing delivered yet (deposits held) */
  depositsHeldVnd: number;
}
