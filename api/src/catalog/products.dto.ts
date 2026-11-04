import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PricingMode } from '../generated/prisma/enums';
import { Vnd } from '../common/dto/fields';

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  /** Decal, Bạt, Biển & hộp đèn, Standee, Ấn phẩm… */
  @IsString() @IsNotEmpty() @MaxLength(100)
  category: string;

  /** AREA: price per m², each line has a size. UNIT: price per unit. */
  @ApiProperty({ enum: PricingMode, enumName: 'PricingMode' })
  @IsEnum(PricingMode)
  pricingMode: PricingMode;

  /** UNIT products only (cái, bộ, hộp…). AREA products always use m². */
  @IsOptional() @IsString() @MaxLength(20)
  unit?: string;

  /** List price in đồng, per m² or per unit */
  @Vnd(1)
  unitPriceVnd: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductQueryDto {
  /** true: only products on sale (the quote picker uses this) */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  active?: boolean;

  /** Name contains (diacritics matter) */
  @IsOptional() @IsString()
  q?: string;
}

export class ProductDto {
  id: string;
  name: string;
  category: string;
  @ApiProperty({ enum: PricingMode, enumName: 'PricingMode' })
  pricingMode: PricingMode;
  unit: string;
  /** Hidden from accounts without money.view */
  unitPriceVnd?: number;
  isActive: boolean;
  note: string | null;
  sortOrder: number;
}
