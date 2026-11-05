import { Inject, Injectable } from '@nestjs/common';
import type { AccountingPeriod } from '../generated/prisma/client';
import { EntryKind, EntrySource, PeriodStatus } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import { ENV, type Env } from '../config/env';
import { DomainError } from '../common/errors/domain-error';
import { parseDateOnly, todayInZone } from '../common/utils/dates';
import { NumberingService, type DocumentPrefix } from '../numbering/numbering.service';
import type { Tx } from '../prisma/prisma.service';
import { STEP_COLUMN, STEPS, firstDay, isBalanced, monthLabel, monthNumber, monthOf, nextMonth } from './ledger';

export interface PostLine {
  account: string;
  debit?: bigint;
  credit?: bigint;
}

export interface PostInput {
  /** Fixed code (DT-2610-0005), or a prefix to number in the posting month */
  code?: string;
  prefix?: DocumentPrefix;
  period: AccountingPeriod;
  date: string;
  description: string;
  kind: EntryKind;
  source?: EntrySource;
  sourceType?: string;
  sourceId?: string;
  orderId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  note?: string | null;
  lines: PostLine[];
  userId?: string | null;
}

/** Kinds whose postings don't change the month's profit, VAT or stock: they leave the month-end steps alone */
const NEUTRAL_KINDS: EntryKind[] = [EntryKind.CUSTOMER_RECEIPT, EntryKind.RECEIPT_VOID, EntryKind.SUPPLIER_PAYMENT];
/** Entries made by the month-end steps */
export const STEP_KINDS: EntryKind[] = [EntryKind.COGS, EntryKind.DEPRECIATION, EntryKind.ALLOCATION, EntryKind.VAT_OFFSET, EntryKind.CLOSING];

/**
 * Periods and the journal. Every posting goes through `post`, which checks the entry balances, uses known
 * accounts, lands in an open period, and resets the month-end steps when it changes the month's figures.
 */
@Injectable()
export class BooksService {
  constructor(
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  today(): string {
    return todayInZone(this.env.APP_TIMEZONE);
  }

  // ───────────── Periods ─────────────

  async periods(tx: Tx): Promise<AccountingPeriod[]> {
    return tx.accountingPeriod.findMany({ orderBy: { month: 'asc' } });
  }

  async period(tx: Tx, id: string): Promise<AccountingPeriod> {
    const p = await tx.accountingPeriod.findUnique({ where: { id } });
    if (!p) throw DomainError.notFound('AccountingPeriod', id);
    return p;
  }

  /** Create every month from the last period up to `month` (the first period when there is none). */
  async ensureMonth(tx: Tx, month: string): Promise<AccountingPeriod> {
    const existing = await tx.accountingPeriod.findUnique({ where: { month } });
    if (existing) return existing;
    const last = await tx.accountingPeriod.findFirst({ orderBy: { month: 'desc' } });
    if (last && monthNumber(month) < monthNumber(last.month)) {
      // A gap before the last period cannot happen (periods are consecutive); a month before the first is handled by callers.
      throw DomainError.badRequest('PERIOD_BEFORE_START', `${monthLabel(month)} is before the first accounting period`);
    }
    let m = last ? nextMonth(last.month) : month;
    let created: AccountingPeriod | null = null;
    while (monthNumber(m) <= monthNumber(month)) {
      created = await tx.accountingPeriod.create({ data: { month: m } });
      m = nextMonth(m);
    }
    return created!;
  }

  /**
   * Period a CRM document dated `ymd` posts to: its own month when open; otherwise the first open month after it
   * (a closed month is never changed). Before the first period it goes to the first open period.
   */
  async postingPeriod(tx: Tx, ymd: string): Promise<{ period: AccountingPeriod; date: string; note: string | null }> {
    const month = monthOf(ymd);
    const first = await tx.accountingPeriod.findFirst({ orderBy: { month: 'asc' } });
    let target: AccountingPeriod;
    if (first && monthNumber(month) < monthNumber(first.month)) {
      target = await this.firstOpenFrom(tx, first.month);
    } else {
      const own = await this.ensureMonth(tx, month);
      target = own.status === PeriodStatus.OPEN ? own : await this.firstOpenFrom(tx, own.month);
    }
    if (target.month === month) return { period: target, date: ymd, note: null };
    return {
      period: target,
      date: firstDay(target.month),
      note: `Chứng từ ngày ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)} thuộc kỳ ${monthLabel(month)} ${first && monthNumber(month) < monthNumber(first.month) ? 'trước kỳ đầu tiên' : 'đã khoá sổ'}, ghi vào kỳ này`,
    };
  }

  private async firstOpenFrom(tx: Tx, month: string): Promise<AccountingPeriod> {
    const open = await tx.accountingPeriod.findFirst({ where: { status: PeriodStatus.OPEN, month: { gte: month } }, orderBy: { month: 'asc' } });
    if (open) return open;
    const last = await tx.accountingPeriod.findFirst({ orderBy: { month: 'desc' } });
    return this.ensureMonth(tx, nextMonth(last!.month));
  }

  /** Period for an accounting document the accountant dates: its month must be open. */
  async openPeriodFor(tx: Tx, ymd: string): Promise<AccountingPeriod> {
    const month = monthOf(ymd);
    const first = await tx.accountingPeriod.findFirst({ orderBy: { month: 'asc' } });
    if (!first) throw DomainError.conflict('BOOKS_NOT_STARTED', 'Set up the first accounting period first');
    if (monthNumber(month) < monthNumber(first.month)) {
      throw DomainError.conflict('PERIOD_BEFORE_START', `${monthLabel(month)} is before the first accounting period ${monthLabel(first.month)}`);
    }
    const p = await this.ensureMonth(tx, month);
    this.assertOpen(p);
    return p;
  }

  assertOpen(p: AccountingPeriod): void {
    if (p.status !== PeriodStatus.OPEN) throw DomainError.conflict('PERIOD_CLOSED', `Period ${monthLabel(p.month)} is closed`);
  }

  async lock(tx: Tx): Promise<void> {
    // One writer of the books at a time (postings, steps, closing): simple and enough for a small shop.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(733133)`;
  }

  /** A posting changed the month: drop what the month-end steps posted and run them again later. */
  async invalidateSteps(tx: Tx, period: AccountingPeriod, userId: string | null, reason: string): Promise<void> {
    const done = STEPS.some((s) => period[STEP_COLUMN[s]] !== null);
    if (!done) return;
    await tx.journalEntry.deleteMany({ where: { periodId: period.id, kind: { in: STEP_KINDS } } });
    await tx.accountingPeriod.update({
      where: { id: period.id },
      data: { pricedAt: null, depreciatedAt: null, allocatedAt: null, vatOffsetAt: null, transferredAt: null },
    });
    await this.log(tx, period.id, 'STEPS_RESET', userId, { reason }, monthLabel(period.month));
  }

  // ───────────── Journal ─────────────

  async post(tx: Tx, input: PostInput): Promise<string> {
    this.assertOpen(input.period);
    const lines = input.lines
      .map((l) => ({ accountCode: l.account, debitVnd: l.debit ?? 0n, creditVnd: l.credit ?? 0n }))
      .filter((l) => l.debitVnd !== 0n || l.creditVnd !== 0n);
    if (lines.some((l) => l.debitVnd < 0n || l.creditVnd < 0n)) throw DomainError.badRequest('ENTRY_NEGATIVE', 'Amounts must not be negative');
    if (!isBalanced(lines)) throw DomainError.badRequest('ENTRY_UNBALANCED', 'Total debit must equal total credit and be above 0');
    await this.assertAccounts(tx, lines.map((l) => l.accountCode));
    const code =
      input.code ??
      (await this.numbering.next(tx, input.prefix!, new Date(`${input.period.month}-15T05:00:00Z`)));
    const entry = await tx.journalEntry.create({
      data: {
        code,
        periodId: input.period.id,
        date: parseDateOnly(input.date),
        description: input.description,
        kind: input.kind,
        source: input.source ?? EntrySource.AUTO,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        orderId: input.orderId ?? null,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        note: input.note ?? null,
        createdById: input.userId ?? null,
        lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
      },
    });
    if (!NEUTRAL_KINDS.includes(input.kind) && !STEP_KINDS.includes(input.kind)) {
      await this.invalidateSteps(tx, input.period, input.userId ?? null, `${code}: ${input.description}`);
    }
    return entry.id;
  }

  async assertAccounts(tx: Tx, codes: string[]): Promise<void> {
    const unique = [...new Set(codes)];
    const found = await tx.ledgerAccount.findMany({ where: { code: { in: unique }, isActive: true }, select: { code: true } });
    const missing = unique.filter((c) => !found.some((f) => f.code === c));
    if (missing.length) throw DomainError.badRequest('ACCOUNT_UNKNOWN', `Unknown account: ${missing.join(', ')}`, { accounts: missing });
  }

  /** Remove the entry a document posted (the document is being deleted in an open period). */
  async unpost(tx: Tx, sourceType: string, sourceId: string, userId: string | null): Promise<void> {
    const entry = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, include: { period: true } });
    if (!entry) return;
    this.assertOpen(entry.period);
    await tx.journalEntry.delete({ where: { id: entry.id } });
    if (!NEUTRAL_KINDS.includes(entry.kind)) await this.invalidateSteps(tx, entry.period, userId, `Xoá ${entry.code}`);
  }

  log(tx: Tx, periodId: string, action: string, userId: string | null, data: Record<string, unknown>, toValue?: string) {
    return this.activity.log(tx, { entityType: 'PERIOD', entityId: periodId, action, toValue: toValue ?? null, data, userId });
  }
}
