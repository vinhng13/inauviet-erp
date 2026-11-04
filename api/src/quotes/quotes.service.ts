import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { QuoteStatus } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import { pageArgs } from '../common/dto/pagination.dto';
import { DomainError } from '../common/errors/domain-error';
import { addDays, formatDateOnly, parseDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { toSearchText } from '../common/utils/vn-text';
import { NumberingService } from '../numbering/numbering.service';
import { OrderRecalcService } from '../orders/order-recalc.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { orderLineDescription, priceLine, type PricedLine, type ProductInfo } from './line-pricing';
import type { BoardQuotesDto } from '../orders/orders.dto';
import type { CloseQuoteDto, CloseQuoteResultDto, LoseQuoteDto, QuoteDto, QuoteListDto, QuoteListItemDto, QuoteQueryDto, SaveQuoteDto } from './quotes.dto';

const quoteInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true, address: true } },
  createdBy: { select: { fullName: true } },
  order: { select: { id: true, code: true } },
  lines: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.QuoteInclude;
type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

const OPEN: QuoteStatus[] = [QuoteStatus.DRAFT, QuoteStatus.SENT];
const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly recalc: OrderRecalcService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private today(): string {
    return todayInZone(this.env.APP_TIMEZONE);
  }

  // ───────────── Mapping ─────────────

  private toListItem(q: QuoteRow): QuoteListItemDto {
    const quoteDate = formatDateOnly(q.quoteDate);
    const validUntil = addDays(quoteDate, q.validDays);
    return {
      id: q.id,
      code: q.code,
      status: q.status,
      customer: q.customer,
      title: q.title,
      quoteDate,
      validDays: q.validDays,
      validUntil,
      isExpired: OPEN.includes(q.status) && validUntil < this.today(),
      totalVnd: Number(q.totalVnd),
      lineCount: q.lines.length,
      order: q.order,
      createdByName: q.createdBy.fullName,
      createdAt: q.createdAt.toISOString(),
    };
  }

  private toDto(q: QuoteRow): QuoteDto {
    return {
      ...this.toListItem(q),
      note: q.note,
      sentAt: q.sentAt?.toISOString() ?? null,
      lostAt: q.lostAt?.toISOString() ?? null,
      lostReason: q.lostReason,
      wonAt: q.wonAt?.toISOString() ?? null,
      updatedAt: q.updatedAt.toISOString(),
      lines: q.lines.map((l) => {
        const w = num(l.widthM);
        const h = num(l.heightM);
        return {
          id: l.id,
          productId: l.productId,
          description: l.description,
          spec: l.spec,
          unit: l.unit,
          widthM: w,
          heightM: h,
          areaM2: w !== null && h !== null ? Math.round(w * h * l.quantity * 100) / 100 : null,
          areaPriceVnd: l.areaPriceVnd === null ? null : Number(l.areaPriceVnd),
          quantity: l.quantity,
          unitPriceVnd: Number(l.unitPriceVnd),
          lineTotalVnd: Number(l.lineTotalVnd),
          sortOrder: l.sortOrder,
        };
      }),
    };
  }

  // ───────────── Reads ─────────────

  async get(id: string): Promise<QuoteDto> {
    const q = await this.prisma.quote.findUnique({ where: { id }, include: quoteInclude });
    if (!q) throw DomainError.notFound('Quote', id);
    return this.toDto(q);
  }

  /** Step 1 column of the board: quotes not yet won or lost, oldest first */
  async openForBoard(q?: string): Promise<BoardQuotesDto> {
    const rows = await this.prisma.quote.findMany({
      where: { AND: [...this.searchWhere(q), { status: { in: OPEN } }] },
      include: quoteInclude,
      orderBy: [{ quoteDate: 'asc' }, { code: 'asc' }],
    });
    return { count: rows.length, sentCount: rows.filter((r) => r.status === QuoteStatus.SENT).length, items: rows.map((r) => this.toListItem(r)) };
  }

  private searchWhere(text: string | undefined): Prisma.QuoteWhereInput[] {
    const base: Prisma.QuoteWhereInput[] = [];
    if (text?.trim()) {
      const q = text.trim();
      const digits = q.replace(/\D/g, '');
      base.push({
        OR: [
          { code: { contains: q.toUpperCase() } },
          { title: { contains: q, mode: 'insensitive' } },
          { customer: { searchText: { contains: toSearchText(q) } } },
          ...(digits.length >= 3 ? [{ customer: { phone: { contains: digits } } }] : []),
          { lines: { some: { description: { contains: q, mode: 'insensitive' as const } } } },
        ],
      });
    }
    return base;
  }

  async list(query: QuoteQueryDto): Promise<QuoteListDto> {
    const base = this.searchWhere(query.q);
    if (query.customerId) base.push({ customerId: query.customerId });
    const where: Prisma.QuoteWhereInput = { AND: [...base, ...(query.status ? [{ status: query.status }] : [])] };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.quote.findMany({ where, include: quoteInclude, orderBy: [{ quoteDate: 'desc' }, { code: 'desc' }], ...pageArgs(query) }),
      this.prisma.quote.count({ where }),
      this.prisma.quote.groupBy({ by: ['status'], where: { AND: base }, _count: { _all: true } }),
    ]);
    const counts = { DRAFT: 0, SENT: 0, WON: 0, LOST: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return { items: rows.map((r) => this.toListItem(r)), total, counts };
  }

  // ───────────── Writes ─────────────

  private async priceLines(tx: Tx, dto: SaveQuoteDto): Promise<PricedLine[]> {
    const ids = [...new Set(dto.lines.map((l) => l.productId).filter((v): v is string => !!v))];
    const products = await tx.product.findMany({ where: { id: { in: ids } } });
    const byId = new Map<string, ProductInfo>(products.map((p) => [p.id, p]));
    return dto.lines.map((l, i) => {
      if (l.productId && !byId.has(l.productId)) throw DomainError.badRequest('PRODUCT_NOT_FOUND', `Line ${i + 1}: product not found`, { index: i });
      return priceLine(l, l.productId ? byId.get(l.productId) : undefined, i);
    });
  }

  private lineRows(lines: PricedLine[]) {
    return lines.map((l, i) => ({
      productId: l.productId,
      description: l.description,
      spec: l.spec,
      unit: l.unit,
      widthM: l.widthM,
      heightM: l.heightM,
      areaPriceVnd: l.areaPriceVnd,
      quantity: l.quantity,
      unitPriceVnd: l.unitPriceVnd,
      lineTotalVnd: l.lineTotalVnd,
      sortOrder: i,
    }));
  }

  async create(dto: SaveQuoteDto, actor: AuthUser): Promise<QuoteDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw DomainError.notFound('Customer', dto.customerId);
    const id = await this.prisma.$transaction(async (tx) => {
      const lines = await this.priceLines(tx, dto);
      const code = await this.numbering.next(tx, 'BG');
      const q = await tx.quote.create({
        data: {
          code,
          customerId: customer.id,
          title: cleanText(dto.title),
          quoteDate: parseDateOnly(this.today()),
          validDays: dto.validDays ?? 7,
          note: cleanText(dto.note),
          totalVnd: lines.reduce((s, l) => s + l.lineTotalVnd, 0n),
          createdById: actor.id,
          lines: { create: this.lineRows(lines) },
        },
      });
      await this.activity.log(tx, { entityType: 'QUOTE', entityId: q.id, action: 'QUOTE_CREATED', toValue: code, userId: actor.id });
      return q.id;
    });
    return this.get(id);
  }

  /** Replace header and lines of a quote that is not closed yet. */
  async update(id: string, dto: SaveQuoteDto, actor: AuthUser): Promise<QuoteDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.loadOpen(tx, id);
      const customer = await tx.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer) throw DomainError.notFound('Customer', dto.customerId);
      const lines = await this.priceLines(tx, dto);
      await tx.quoteLine.deleteMany({ where: { quoteId: id } });
      await tx.quote.update({
        where: { id },
        data: {
          customerId: customer.id,
          title: cleanText(dto.title),
          validDays: dto.validDays ?? 7,
          note: cleanText(dto.note),
          totalVnd: lines.reduce((s, l) => s + l.lineTotalVnd, 0n),
          lines: { create: this.lineRows(lines) },
        },
      });
      await this.activity.log(tx, { entityType: 'QUOTE', entityId: id, action: 'QUOTE_UPDATED', data: { lineCount: lines.length }, userId: actor.id });
    });
    return this.get(id);
  }

  async markSent(id: string, actor: AuthUser): Promise<QuoteDto> {
    await this.prisma.$transaction(async (tx) => {
      const q = await this.loadOpen(tx, id);
      if (q.status === QuoteStatus.SENT) return;
      await tx.quote.update({ where: { id }, data: { status: QuoteStatus.SENT, sentAt: new Date() } });
      await this.activity.log(tx, { entityType: 'QUOTE', entityId: id, action: 'STATUS_CHANGED', fromValue: q.status, toValue: QuoteStatus.SENT, userId: actor.id });
    });
    return this.get(id);
  }

  async lose(id: string, dto: LoseQuoteDto, actor: AuthUser): Promise<QuoteDto> {
    await this.prisma.$transaction(async (tx) => {
      const q = await this.loadOpen(tx, id);
      await tx.quote.update({ where: { id }, data: { status: QuoteStatus.LOST, lostAt: new Date(), lostReason: dto.reason.trim() } });
      await this.activity.log(tx, { entityType: 'QUOTE', entityId: id, action: 'STATUS_CHANGED', fromValue: q.status, toValue: QuoteStatus.LOST, data: { reason: dto.reason.trim() }, userId: actor.id });
    });
    return this.get(id);
  }

  /** A lost quote can be worked on again (the customer came back). */
  async reopen(id: string, actor: AuthUser): Promise<QuoteDto> {
    await this.prisma.$transaction(async (tx) => {
      const q = await tx.quote.findUnique({ where: { id } });
      if (!q) throw DomainError.notFound('Quote', id);
      if (q.status !== QuoteStatus.LOST) throw DomainError.conflict('QUOTE_NOT_LOST', 'Only a lost quote can be reopened');
      await tx.quote.update({ where: { id }, data: { status: q.sentAt ? QuoteStatus.SENT : QuoteStatus.DRAFT, lostAt: null, lostReason: null } });
      await this.activity.log(tx, { entityType: 'QUOTE', entityId: id, action: 'STATUS_CHANGED', fromValue: QuoteStatus.LOST, toValue: q.sentAt ? QuoteStatus.SENT : QuoteStatus.DRAFT, userId: actor.id });
    });
    return this.get(id);
  }

  /** Step 2: the customer agreed. Creates the order with the quote's lines; the order can then be adjusted. */
  async close(id: string, dto: CloseQuoteDto, actor: AuthUser): Promise<CloseQuoteResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const q = await this.loadOpen(tx, id);
      const lines = await tx.quoteLine.findMany({ where: { quoteId: id }, orderBy: { sortOrder: 'asc' } });
      const code = await this.numbering.next(tx, 'DH');
      const order = await tx.order.create({
        data: {
          code,
          quoteId: q.id,
          customerId: q.customerId,
          orderDate: parseDateOnly(this.today()),
          dueDate: dto.dueDate ? dateField(dto.dueDate, 'dueDate') : null,
          note: cleanText(dto.note) ?? q.note,
          createdById: actor.id,
          lines: {
            create: lines.map((l, i) => ({
              productId: l.productId,
              quoteLineId: l.id,
              description: orderLineDescription({ description: l.description, widthM: num(l.widthM), heightM: num(l.heightM) }),
              spec: l.spec,
              unit: l.unit,
              widthM: l.widthM,
              heightM: l.heightM,
              areaPriceVnd: l.areaPriceVnd,
              quantity: l.quantity,
              unitPriceVnd: l.unitPriceVnd,
              sortOrder: i,
            })),
          },
        },
      });
      await tx.quote.update({ where: { id }, data: { status: QuoteStatus.WON, wonAt: new Date() } });
      await this.activity.log(tx, { entityType: 'QUOTE', entityId: id, action: 'STATUS_CHANGED', fromValue: q.status, toValue: QuoteStatus.WON, data: { orderCode: code }, userId: actor.id });
      await this.activity.log(tx, { orderId: order.id, entityType: 'ORDER', entityId: order.id, action: 'ORDER_CREATED', toValue: code, data: { quoteCode: q.code }, userId: actor.id });
      await this.recalc.recalc(tx, order.id, actor.id);
      return { orderId: order.id, orderCode: code };
    });
  }

  private async loadOpen(tx: Tx, id: string) {
    const q = await tx.quote.findUnique({ where: { id } });
    if (!q) throw DomainError.notFound('Quote', id);
    if (q.status === QuoteStatus.WON) throw DomainError.conflict('QUOTE_CLOSED', `${q.code} was already closed into an order`);
    if (q.status === QuoteStatus.LOST) throw DomainError.conflict('QUOTE_LOST', `${q.code} is marked lost; reopen it first`);
    return q;
  }
}
