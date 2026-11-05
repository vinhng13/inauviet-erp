import { Inject, Injectable } from '@nestjs/common';
import { EntryKind, PaymentMethod, PeriodStatus } from '../generated/prisma/enums';
import { ENV, type Env } from '../config/env';
import { formatDateOnly, parseDateOnly, todayInZone } from '../common/utils/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { BooksService } from './books.service';
import { DEFAULT_VAT_RATE, firstDay, vatOf } from './ledger';

export const SOURCE = {
  payment: 'PAYMENT',
  paymentVoid: 'PAYMENT_VOID',
  revenue: 'ORDER_REVENUE',
  cogs: 'ORDER_COGS',
  receipt: 'STOCK_RECEIPT',
  issue: 'STOCK_ISSUE',
  cash: 'CASH_PAYMENT',
  asset: 'ASSET',
} as const;

const cashAccount = (m: PaymentMethod) => (m === PaymentMethod.BANK_TRANSFER ? '112' : '111');

/**
 * Brings what the CRM recorded into the books, without the CRM knowing about accounting:
 *  - every payment received → PT: Dr 111/112, Cr 131
 *  - a payment voided later → its PT is removed (open month) or reversed in the current open month
 *  - every accepted order with prices → DT: Dr 131, Cr 511 + 33311 (VAT 8% on the order total)
 * Idempotent (one entry per source document); runs before accounting reads and writes.
 */
@Injectable()
export class CrmSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Documents dated before the first period are part of its opening balances and are not posted. */
  async sync(): Promise<number> {
    const first = await this.prisma.accountingPeriod.findFirst({ orderBy: { month: 'asc' } });
    if (!first) return 0;
    const from = firstDay(first.month);
    return this.prisma.$transaction(async (tx) => {
      await this.books.lock(tx);
      return (await this.payments(tx, from)) + (await this.voids(tx)) + (await this.revenue(tx, from));
    });
  }

  private async posted(tx: Tx, sourceType: string): Promise<Set<string>> {
    const rows = await tx.journalEntry.findMany({ where: { sourceType }, select: { sourceId: true } });
    return new Set(rows.map((r) => r.sourceId!));
  }

  private async payments(tx: Tx, from: string): Promise<number> {
    const done = await this.posted(tx, SOURCE.payment);
    const voided = await this.posted(tx, SOURCE.paymentVoid);
    const rows = await tx.payment.findMany({
      where: { voidedAt: null, paidOn: { gte: parseDateOnly(from) } },
      include: { order: { select: { id: true, code: true, customerId: true, customer: { select: { name: true } } } } },
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
    });
    let n = 0;
    for (const p of rows) {
      if (done.has(p.id) || voided.has(p.id)) continue;
      const { period, date, note } = await this.books.postingPeriod(tx, formatDateOnly(p.paidOn));
      await this.books.post(tx, {
        prefix: 'PT',
        period,
        date,
        description: `Thu tiền ${p.order.customer.name} · ${p.order.code}${p.isDeposit ? ' (cọc)' : ''}`,
        kind: EntryKind.CUSTOMER_RECEIPT,
        sourceType: SOURCE.payment,
        sourceId: p.id,
        orderId: p.order.id,
        customerId: p.order.customerId,
        note,
        lines: [
          { account: cashAccount(p.method), debit: p.amountVnd },
          { account: '131', credit: p.amountVnd },
        ],
        userId: p.recordedById,
      });
      n++;
    }
    return n;
  }

  private async voids(tx: Tx): Promise<number> {
    const reversed = await this.posted(tx, SOURCE.paymentVoid);
    const rows = await tx.payment.findMany({ where: { voidedAt: { not: null } }, select: { id: true } });
    let n = 0;
    for (const p of rows) {
      if (reversed.has(p.id)) continue;
      const entry = await tx.journalEntry.findUnique({
        where: { sourceType_sourceId: { sourceType: SOURCE.payment, sourceId: p.id } },
        include: { period: true, lines: true },
      });
      if (!entry) continue;
      if (entry.period.status === PeriodStatus.OPEN) {
        await tx.journalEntry.delete({ where: { id: entry.id } });
      } else {
        const today = todayInZone(this.env.APP_TIMEZONE);
        const { period, date } = await this.books.postingPeriod(tx, today);
        await this.books.post(tx, {
          code: `${entry.code}-H`,
          period,
          date,
          description: `Huỷ ${entry.code}: ${entry.description}`,
          kind: EntryKind.RECEIPT_VOID,
          sourceType: SOURCE.paymentVoid,
          sourceId: p.id,
          orderId: entry.orderId,
          customerId: entry.customerId,
          note: `Khoản thu bị huỷ sau khi kỳ ${entry.period.month.slice(5)}/${entry.period.month.slice(0, 4)} đã khoá sổ`,
          lines: entry.lines.map((l) => ({ account: l.accountCode, debit: l.creditVnd, credit: l.debitVnd })),
        });
      }
      n++;
    }
    return n;
  }

  private async revenue(tx: Tx, from: string): Promise<number> {
    const done = await this.posted(tx, SOURCE.revenue);
    const rows = await tx.order.findMany({
      where: { acceptedAt: { not: null }, totalVnd: { not: null } },
      select: { id: true, code: true, customerId: true, totalVnd: true, acceptedAt: true, customer: { select: { name: true } } },
      orderBy: { acceptedAt: 'asc' },
    });
    let n = 0;
    for (const o of rows) {
      const acceptedOn = todayInZone(this.env.APP_TIMEZONE, o.acceptedAt!);
      if (done.has(o.id) || !o.totalVnd || o.totalVnd <= 0n || acceptedOn < from) continue;
      const { period, date, note } = await this.books.postingPeriod(tx, acceptedOn);
      const vat = vatOf(o.totalVnd, DEFAULT_VAT_RATE);
      await this.books.post(tx, {
        code: `DT-${o.code.slice(3)}`,
        period,
        date,
        description: `Doanh thu khi nghiệm thu · ${o.customer.name}`,
        kind: EntryKind.REVENUE,
        sourceType: SOURCE.revenue,
        sourceId: o.id,
        orderId: o.id,
        customerId: o.customerId,
        note,
        lines: [
          { account: '131', debit: o.totalVnd + vat },
          { account: '511', credit: o.totalVnd },
          { account: '33311', credit: vat },
        ],
      });
      n++;
    }
    return n;
  }
}
