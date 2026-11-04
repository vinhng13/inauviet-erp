import { PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/dto/pagination.dto';

export class CreateCustomerDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  name: string;

  /** Any common format: 0903 123 456, +84903123456, 0903.123.456 */
  @IsString() @IsNotEmpty() @MaxLength(20)
  phone: string;

  @IsOptional() @IsString() @MaxLength(200)
  companyName?: string;

  /** Mã số thuế, for VAT invoices */
  @IsOptional() @IsString() @MaxLength(20)
  taxCode?: string;

  /** Default delivery address */
  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerQueryDto extends PageQueryDto {}

export class CustomerDto {
  id: string;
  /** KH-0001 */
  code: string;
  name: string;
  phone: string;
  companyName: string | null;
  taxCode: string | null;
  address: string | null;
  note: string | null;
  createdAt: string;
}

export class CustomerListDto {
  items: CustomerDto[];
  total: number;
}

export class CustomerSummaryDto extends CustomerDto {
  orderCount: number;
  /** Orders that are not completed or cancelled */
  openOrderCount: number;
  /** Sum of order totals (priced orders, not cancelled) */
  totalVnd: number;
  paidVnd: number;
  /** totalVnd - paidVnd */
  balanceVnd: number;
}
