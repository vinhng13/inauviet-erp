import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { OrderStatus, QuoteStatus } from '../generated/prisma/enums';
import { DOC_KINDS, type DocKind } from './templates';

const toBool = ({ value }: { value: unknown }) => (value === true || value === 'true' || value === '1' ? true : value === false || value === 'false' || value === '0' ? false : value);
const toList = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value);

export class DocumentQueryDto {
  /** true: send as a file to save (Content-Disposition: attachment); default: open in the browser */
  @IsOptional() @Transform(toBool) @IsBoolean()
  download?: boolean;
}

export class ZipQueryDto extends DocumentQueryDto {
  /** Comma-separated kinds to include, e.g. "quote,order,invoice". Default: every available document. */
  @ApiProperty({ required: false, type: String, example: 'quote,order,design,lsx,acceptance,invoice' })
  @IsOptional() @Transform(toList) @IsIn(DOC_KINDS, { each: true })
  kinds?: DocKind[];
}

export class DocumentFileDto {
  @ApiProperty({ enum: DOC_KINDS, enumName: 'DocKind' })
  kind: DocKind;
  /** Quote id for kind "quote", order id otherwise */
  sourceId: string;
  /** Short label, e.g. "Báo giá" */
  label: string;
  /** BG-2610-0004_BaoGia.pdf */
  fileName: string;
}

/** One quote (with the order it became, if any) and its documents */
export class CustomerDocumentRowDto {
  /** Order id, or quote id when the quote never became an order */
  key: string;
  orderId: string | null;
  orderCode: string | null;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus', nullable: true })
  orderStatus: OrderStatus | null;
  quoteId: string | null;
  quoteCode: string | null;
  @ApiProperty({ enum: QuoteStatus, enumName: 'QuoteStatus', nullable: true })
  quoteStatus: QuoteStatus | null;
  /** Quote title, or the order's first lines */
  title: string;
  @ApiProperty({ type: 'string', format: 'date' })
  date: string;
  totalVnd: number | null;
  files: DocumentFileDto[];
}

export class CustomerDocumentsDto {
  rows: CustomerDocumentRowDto[];
  /** Name of the zip with every document */
  zipName: string;
}
