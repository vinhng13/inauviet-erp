import { Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CustomerDocumentsDto, DocumentQueryDto, ZipQueryDto } from './documents.dto';
import { DocumentsService, type FileOut } from './documents.service';
import { DOC_KINDS, type DocKind } from './templates';

function send(res: Response, file: FileOut, download: boolean): StreamableFile {
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_');
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(file.body);
}

/** Printable documents as PDF, and zipped bundles per order or per customer. */
@ApiTags('documents')
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** One document. `id` is the quote id for "quote", the order id otherwise. Opens in the browser unless `download=true`. */
  @RequirePermission('orders.view')
  @ApiProduces('application/pdf')
  @Get('documents/:kind/:id')
  async one(
    @Param('kind', new ParseEnumPipe(DOC_KINDS)) kind: DocKind,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DocumentQueryDto,
    @CurrentUser() actor: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(res, await this.documents.render(kind, id, actor), !!query.download);
  }

  /** Every document of an order (and its quote) in one zip */
  @RequirePermission('orders.view')
  @ApiProduces('application/zip')
  @Get('orders/:id/documents/zip')
  async orderZip(@Param('id', ParseUUIDPipe) id: string, @Query() query: ZipQueryDto, @CurrentUser() actor: AuthUser, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return send(res, await this.documents.orderZip(id, query.kinds, actor), true);
  }

  /** The customer's quotes and orders with the documents each one has */
  @RequirePermission('customers.view', 'orders.view')
  @Get('customers/:id/documents')
  forCustomer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<CustomerDocumentsDto> {
    return this.documents.forCustomer(id, actor);
  }

  /** Every document of the customer, one folder per order / quote */
  @RequirePermission('customers.view', 'orders.view')
  @ApiProduces('application/zip')
  @Get('customers/:id/documents/zip')
  async customerZip(@Param('id', ParseUUIDPipe) id: string, @Query() query: ZipQueryDto, @CurrentUser() actor: AuthUser, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return send(res, await this.documents.customerZip(id, query.kinds, actor), true);
  }
}
