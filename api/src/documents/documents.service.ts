import { Inject, Injectable } from '@nestjs/common';
import { zipSync } from 'fflate';
import { DeliveryStatus, OrderStatus } from '../generated/prisma/enums';
import { can, type AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly, todayInZone } from '../common/utils/dates';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotesService } from '../quotes/quotes.service';
import type { CustomerDocumentRowDto, CustomerDocumentsDto, DocumentFileDto } from './documents.dto';
import { renderPdf } from './pdf';
import { DOC_META, orderDoc, orderDocNumber, quoteDoc, type Ctx, type DocKind } from './templates';

export interface FileOut {
  fileName: string;
  contentType: string;
  body: Buffer;
}

type OrderKind = Exclude<DocKind, 'quote'>;

/** What decides which documents an order has, without loading the whole order */
const orderStateSelect = {
  id: true,
  code: true,
  status: true,
  productionCode: true,
  productionStartedAt: true,
  quoteId: true,
  _count: { select: { designs: true, deliveries: { where: { status: DeliveryStatus.DELIVERED } } } },
} as const;
interface OrderState {
  id: string;
  code: string;
  status: OrderStatus;
  productionCode: string | null;
  productionStartedAt: Date | null;
  quoteId: string | null;
  _count: { designs: number; deliveries: number };
}

/**
 * Documents as PDF files (quote, order, design approval, work order, acceptance report, invoice), one at a time
 * or zipped per order / per customer. Documents with prices need money.view; the quote also needs quotes.view.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly quotes: QuotesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Rules ─────────────

  private allowed(kind: DocKind, actor: AuthUser): boolean {
    if (DOC_META[kind].priced && !can(actor, 'money.view')) return false;
    if (kind === 'quote' && !can(actor, 'quotes.view')) return false;
    return true;
  }

  /** Order documents that exist at the order's current step */
  private orderKinds(o: OrderState): OrderKind[] {
    const kinds: OrderKind[] = ['order'];
    if (o._count.designs > 0) kinds.push('design');
    if (o.productionStartedAt) kinds.push('lsx');
    if (o.status === OrderStatus.DELIVERING || o.status === OrderStatus.COMPLETED || o._count.deliveries > 0) kinds.push('acceptance');
    kinds.push('invoice');
    return kinds;
  }

  private orderFile(kind: OrderKind, o: { id: string; code: string; productionCode: string | null }): DocumentFileDto {
    return { kind, sourceId: o.id, label: DOC_META[kind].label, fileName: `${orderDocNumber(kind, o)}_${DOC_META[kind].suffix}.pdf` };
  }

  private quoteFile(q: { id: string; code: string }): DocumentFileDto {
    return { kind: 'quote', sourceId: q.id, label: DOC_META.quote.label, fileName: `${q.code}_${DOC_META.quote.suffix}.pdf` };
  }

  /** Files of one order (plus the quote it came from) this account may download */
  private async filesForOrder(o: OrderState, actor: AuthUser, kinds?: DocKind[]): Promise<DocumentFileDto[]> {
    const want = (k: DocKind) => (!kinds || kinds.includes(k)) && this.allowed(k, actor);
    const files: DocumentFileDto[] = [];
    if (o.quoteId && want('quote')) {
      const q = await this.prisma.quote.findUnique({ where: { id: o.quoteId }, select: { id: true, code: true } });
      if (q) files.push(this.quoteFile(q));
    }
    for (const k of this.orderKinds(o)) if (want(k)) files.push(this.orderFile(k, o));
    return files;
  }

  private ctx(actor: AuthUser): Ctx {
    return {
      company: { name: this.env.COMPANY_NAME, address: this.env.COMPANY_ADDRESS, phone: this.env.COMPANY_PHONE, taxCode: this.env.COMPANY_TAX_CODE },
      printedBy: actor.fullName,
      today: todayInZone(this.env.APP_TIMEZONE),
    };
  }

  // ───────────── One document ─────────────

  async render(kind: DocKind, id: string, actor: AuthUser): Promise<FileOut> {
    if (!this.allowed(kind, actor)) {
      throw DomainError.forbidden('PERMISSION_DENIED', DOC_META[kind].priced ? 'Documents with prices need permission money.view' : 'Not allowed');
    }
    if (kind === 'quote') {
      const q = await this.quotes.get(id);
      return { fileName: this.quoteFile(q).fileName, contentType: 'application/pdf', body: await renderPdf(quoteDoc(q, this.ctx(actor))) };
    }
    const state = await this.prisma.order.findUnique({ where: { id }, select: orderStateSelect });
    if (!state) throw DomainError.notFound('Order', id);
    if (!this.orderKinds(state).includes(kind)) {
      throw DomainError.conflict('DOCUMENT_NOT_AVAILABLE', `${DOC_META[kind].label} does not exist yet for ${state.code}`, { kind });
    }
    const order = await this.orders.get(id, actor);
    return { fileName: this.orderFile(kind, state).fileName, contentType: 'application/pdf', body: await renderPdf(orderDoc(kind, order, this.ctx(actor))) };
  }

  // ───────────── Bundles ─────────────

  private async zip(entries: Array<{ path: string; file: DocumentFileDto }>, actor: AuthUser, zipName: string): Promise<FileOut> {
    if (entries.length === 0) throw DomainError.conflict('DOCUMENT_NOT_AVAILABLE', 'No document to download');
    const files: Record<string, Uint8Array> = {};
    // One at a time: rendering is CPU-bound and a customer may have many documents.
    for (const e of entries) files[e.path] = new Uint8Array((await this.render(e.file.kind, e.file.sourceId, actor)).body);
    return { fileName: zipName, contentType: 'application/zip', body: Buffer.from(zipSync(files, { level: 6 })) };
  }

  async orderZip(id: string, kinds: DocKind[] | undefined, actor: AuthUser): Promise<FileOut> {
    const state = await this.prisma.order.findUnique({ where: { id }, select: orderStateSelect });
    if (!state) throw DomainError.notFound('Order', id);
    const files = await this.filesForOrder(state, actor, kinds);
    return this.zip(files.map((file) => ({ path: file.fileName, file })), actor, `${state.code}_TaiLieu.zip`);
  }

  async forCustomer(customerId: string, actor: AuthUser): Promise<CustomerDocumentsDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { code: true, name: true } });
    if (!customer) throw DomainError.notFound('Customer', customerId);
    const [orders, quotes] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId },
        select: {
          ...orderStateSelect,
          orderDate: true,
          totalVnd: true,
          quote: { select: { id: true, code: true, status: true, title: true } },
          lines: { select: { description: true }, orderBy: { sortOrder: 'asc' }, take: 3 },
        },
        orderBy: [{ orderDate: 'desc' }, { code: 'desc' }],
      }),
      can(actor, 'quotes.view')
        ? this.prisma.quote.findMany({
            where: { customerId, order: null },
            select: { id: true, code: true, status: true, title: true, quoteDate: true, totalVnd: true, lines: { select: { description: true }, orderBy: { sortOrder: 'asc' }, take: 3 } },
          })
        : Promise.resolve([]),
    ]);

    const summary = (lines: Array<{ description: string }>) => lines.map((l) => l.description).join(', ');
    const rows: CustomerDocumentRowDto[] = [];
    for (const o of orders) {
      rows.push({
        key: o.id,
        orderId: o.id,
        orderCode: o.code,
        orderStatus: o.status,
        quoteId: o.quote?.id ?? null,
        quoteCode: o.quote?.code ?? null,
        quoteStatus: o.quote?.status ?? null,
        title: o.quote?.title ?? summary(o.lines),
        date: formatDateOnly(o.orderDate),
        totalVnd: o.totalVnd === null ? null : Number(o.totalVnd),
        files: await this.filesForOrder(o, actor),
      });
    }
    for (const q of quotes) {
      rows.push({
        key: q.id,
        orderId: null,
        orderCode: null,
        orderStatus: null,
        quoteId: q.id,
        quoteCode: q.code,
        quoteStatus: q.status,
        title: q.title ?? summary(q.lines),
        date: formatDateOnly(q.quoteDate),
        totalVnd: Number(q.totalVnd),
        files: this.allowed('quote', actor) ? [this.quoteFile(q)] : [],
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || (b.orderCode ?? b.quoteCode ?? '').localeCompare(a.orderCode ?? a.quoteCode ?? ''));
    return { rows, zipName: `${customer.code}_${slug(customer.name)}_TaiLieu.zip` };
  }

  async customerZip(customerId: string, kinds: DocKind[] | undefined, actor: AuthUser): Promise<FileOut> {
    const { rows, zipName } = await this.forCustomer(customerId, actor);
    const entries = rows.flatMap((r) =>
      r.files.filter((f) => !kinds || kinds.includes(f.kind)).map((file) => ({ path: `${r.orderCode ?? r.quoteCode}/${file.fileName}`, file })),
    );
    return this.zip(entries, actor, zipName);
  }
}

/** "Anh Minh" → "AnhMinh" for file names */
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '');
}
