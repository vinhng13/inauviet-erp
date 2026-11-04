import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { QuoteStatus } from '../generated/prisma/enums';
import { PageQueryDto } from '../common/dto/pagination.dto';
import { DateOnly, Vnd } from '../common/dto/fields';

// ───────────── Input ─────────────

export class QuoteLineInputDto {
  /** Catalog product; leave empty for a free-text line */
  @IsOptional() @IsUUID()
  productId?: string | null;

  /** Defaults to the product name */
  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  spec?: string;

  /** Free-text lines only (cái, bộ, gói…) */
  @IsOptional() @IsString() @MaxLength(20)
  unit?: string;

  /** Metres, products priced per m² */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100)
  widthM?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100)
  heightM?: number | null;

  /** Pieces / units */
  @IsInt() @Min(1)
  quantity: number;

  /** Per m² for products priced per m², otherwise per unit. Defaults to the catalog price. */
  @IsOptional() @Vnd()
  unitPriceVnd?: number | null;
}

export class SaveQuoteDto {
  @IsUUID()
  customerId: string;

  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  /** Days the quote stays valid (default 7) */
  @IsOptional() @IsInt() @Min(1) @Max(365)
  validDays?: number;

  /** Printed on the quote */
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ValidateNested({ each: true }) @Type(() => QuoteLineInputDto) @ArrayMinSize(1)
  lines: QuoteLineInputDto[];
}

export class LoseQuoteDto {
  /** Why the customer did not order */
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class CloseQuoteDto {
  @IsOptional() @DateOnly()
  dueDate?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class QuoteQueryDto extends PageQueryDto {
  @ApiProperty({ enum: QuoteStatus, enumName: 'QuoteStatus', required: false })
  @IsOptional() @IsEnum(QuoteStatus)
  status?: QuoteStatus;

  @IsOptional() @IsUUID()
  customerId?: string;
}

// ───────────── Output ─────────────

export class QuoteCustomerDto {
  id: string;
  code: string;
  name: string;
  phone: string;
  address: string | null;
}

export class QuoteLineDto {
  id: string;
  productId: string | null;
  description: string;
  spec: string | null;
  unit: string;
  widthM: number | null;
  heightM: number | null;
  /** width × height × quantity, AREA lines only */
  areaM2: number | null;
  /** Price per m², AREA lines only */
  areaPriceVnd?: number | null;
  quantity: number;
  /** Price of one piece / unit */
  unitPriceVnd?: number;
  lineTotalVnd?: number;
  sortOrder: number;
}

export class QuoteOrderRefDto {
  id: string;
  code: string;
}

export class QuoteListItemDto {
  id: string;
  /** BG-2610-0012 */
  code: string;
  @ApiProperty({ enum: QuoteStatus, enumName: 'QuoteStatus' })
  status: QuoteStatus;
  customer: QuoteCustomerDto;
  title: string | null;
  @ApiProperty({ format: 'date' })
  quoteDate: string;
  validDays: number;
  @ApiProperty({ format: 'date' })
  validUntil: string;
  /** Still DRAFT or SENT after validUntil */
  isExpired: boolean;
  totalVnd?: number;
  lineCount: number;
  order: QuoteOrderRefDto | null;
  createdByName: string;
  createdAt: string;
}

export class QuoteDto extends QuoteListItemDto {
  note: string | null;
  sentAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  wonAt: string | null;
  updatedAt: string;
  lines: QuoteLineDto[];
}

export class QuoteCountsDto {
  DRAFT: number;
  SENT: number;
  WON: number;
  LOST: number;
}

export class QuoteListDto {
  items: QuoteListItemDto[];
  total: number;
  /** Per status, for the same search (ignores the status filter) */
  counts: QuoteCountsDto;
}

export class CloseQuoteResultDto {
  orderId: string;
  orderCode: string;
}
