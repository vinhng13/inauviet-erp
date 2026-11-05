import { Injectable } from '@nestjs/common';
import type { AccountingPeriod } from '../generated/prisma/client';
import { AssetKind, EntryKind, PeriodStatus } from '../generated/prisma/enums';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { BooksService, type PostLine } from './books.service';
import { FiguresService } from './figures.service';
import {
  EXPENSE_ACCOUNTS,
  REVENUE_ACCOUNTS,
  STEP_COLUMN,
  STEPS,
  lastDay,
  monthCode,
  monthLabel,
  netCredit,
  overheadOf,
  profitOf,
  nextMonth,
  valueOf,
  vnd,
  type Step,
} from './ledger';
import { SOURCE } from './sync.service';

const STEP_LABEL: Record<Step, string> = {
  price: 'Tính giá xuất kho bình quân',
  depreciation: 'Khấu hao TSCĐ',
  allocation: 'Phân bổ công cụ dụng cụ',
  vat: 'Khấu trừ thuế GTGT',
  transfer: 'Kết chuyển lãi lỗ',
};

/**
 * Month-end, in order: price issues at the monthly weighted average (and post cost of goods for orders accepted
 * this month), depreciation, tool allocation, VAT offset, transfers to 911 and 421; then close the month and carry
 * balances and stock to the next one. A closed month can be reopened (the latest closed one only).
 */
@Injectable()
export class ClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly figures: FiguresService,
  ) {}

  async previousOpen(tx: Tx, period: AccountingPeriod): Promise<boolean> {
    return (await tx.accountingPeriod.count({ where: { month: { lt: period.month }, status: PeriodStatus.OPEN } })) > 0;
  }

  async runStep(periodId: string, step: Step, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.books.lock(tx);
      const period = await this.books.period(tx, periodId);
      this.books.assertOpen(period);
      if (await this.previousOpen(tx, period)) throw DomainError.conflict('PREVIOUS_PERIOD_OPEN', 'Close the earlier month first');
      await this.assertOpeningsBalanced(tx, period);
      const index = STEPS.indexOf(step);
      for (const s of STEPS.slice(0, index)) {
        if (!period[STEP_COLUMN[s]]) throw DomainError.conflict('STEP_ORDER', `Run "${STEP_LABEL[s]}" first`, { step: s });
      }
      if (period[STEP_COLUMN[step]]) throw DomainError.conflict('STEP_DONE', `"${STEP_LABEL[step]}" already ran`);
      const summary = await this[step](tx, period, actor);
      await tx.accountingPeriod.update({ where: { id: period.id }, data: { [STEP_COLUMN[step]]: new Date() } });
      await this.books.log(tx, period.id, 'STEP_RUN', actor.id, { step, summary }, STEP_LABEL[step]);
    });
  }

  private async assertOpeningsBalanced(tx: Tx, period: AccountingPeriod): Promise<void> {
    const opening = await this.figures.openings(tx, period.id);
    const diff = [...opening.values()].reduce((s, v) => s + v, 0n);
    if (diff !== 0n) throw DomainError.conflict('OPENINGS_UNBALANCED', 'Opening balances do not balance', { differenceVnd: Number(diff) });
  }

  private postStep(tx: Tx, period: AccountingPeriod, code: string, description: string, kind: EntryKind, lines: PostLine[], actor: AuthUser, orderId?: string) {
    return this.books.post(tx, { code, period, date: lastDay(period.month), description, kind, lines, userId: actor.id, orderId });
  }

  /**
   * 1. Monthly weighted average: re-value this month's issues; then cost of goods for orders accepted this month
   * (everything ever issued to them) and for orders accepted earlier that got more material this month.
   */
  private async price(tx: Tx, period: AccountingPeriod, actor: AuthUser): Promise<string> {
    const stock = await this.figures.stock(tx, { ...period, pricedAt: new Date() });
    const avg = new Map(stock.map((s) => [s.materialId, s.average]));
    const issues = await tx.stockIssue.findMany({ where: { periodId: period.id }, include: { lines: true } });
    for (const issue of issues) {
      let value = 0n;
      for (const l of issue.lines) {
        const price = avg.get(l.materialId) ?? 0n;
        value += valueOf(Number(l.qty.toString()), price);
        if (price !== l.priceVnd) await tx.stockIssueLine.update({ where: { id: l.id }, data: { priceVnd: price } });
      }
      const entry = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: SOURCE.issue, sourceId: issue.id } } });
      if (entry?.originalLines) continue; // changed by hand: the accountant's figures stand
      const lines: PostLine[] = [{ account: '154', debit: value }, { account: '152', credit: value }];
      if (entry) {
        await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
        if (value > 0n) {
          await tx.journalLine.createMany({ data: lines.map((l, i) => ({ entryId: entry.id, accountCode: l.account, debitVnd: l.debit ?? 0n, creditVnd: l.credit ?? 0n, sortOrder: i })) });
        } else {
          await tx.journalEntry.delete({ where: { id: entry.id } });
        }
      } else if (value > 0n) {
        await this.books.post(tx, {
          code: issue.code,
          period,
          date: issue.date.toISOString().slice(0, 10),
          description: `Xuất kho ${issue.code}`,
          kind: EntryKind.ISSUE,
          sourceType: SOURCE.issue,
          sourceId: issue.id,
          orderId: issue.orderId,
          lines,
          userId: actor.id,
        });
      }
    }

    const issuedValue = (rows: Array<{ qty: { toString(): string }; priceVnd: bigint }>) => rows.reduce((s, l) => s + valueOf(Number(l.qty.toString()), l.priceVnd), 0n);
    let cogs = 0n;
    const postCogs = async (code: string, orderId: string, value: bigint, description: string) => {
      if (value <= 0n) return;
      cogs += value;
      await this.postStep(tx, period, code, description, EntryKind.COGS, [{ account: '632', debit: value }, { account: '154', credit: value }], actor, orderId);
    };
    const accepted = await tx.journalEntry.findMany({ where: { kind: EntryKind.REVENUE, orderId: { not: null } }, select: { orderId: true, code: true, periodId: true, period: { select: { month: true } } } });
    for (const r of accepted.filter((a) => a.periodId === period.id)) {
      const lines = await tx.stockIssueLine.findMany({ where: { issue: { orderId: r.orderId, period: { month: { lte: period.month } } } } });
      await postCogs(r.code.replace(/^DT-/, 'GV-'), r.orderId!, issuedValue(lines), 'Giá vốn nguyên vật liệu của đơn đã nghiệm thu');
    }
    for (const r of accepted.filter((a) => a.period.month < period.month)) {
      const lines = issues.filter((i) => i.orderId === r.orderId).flatMap((i) => i.lines);
      const value = lines.reduce((s, l) => s + valueOf(Number(l.qty.toString()), avg.get(l.materialId) ?? 0n), 0n);
      await postCogs(`${r.code.replace(/^DT-/, 'GV-')}-${monthCode(period.month)}`, r.orderId!, value, 'Giá vốn vật tư xuất thêm cho đơn đã nghiệm thu');
    }
    return `${stock.length} vật tư · ${issues.length} phiếu xuất · giá vốn ${vnd(cogs)}`;
  }

  private async assetStep(tx: Tx, period: AccountingPeriod, actor: AuthUser, kind: AssetKind): Promise<string> {
    const charges = (await this.figures.charges(tx, period.month, kind)).filter((c) => c.monthly > 0n);
    const byAccount = new Map<string, bigint>();
    for (const c of charges) byAccount.set(c.asset.expenseAccount, (byAccount.get(c.asset.expenseAccount) ?? 0n) + c.monthly);
    const total = [...byAccount.values()].reduce((s, v) => s + v, 0n);
    if (total > 0n) {
      const fixed = kind === AssetKind.FIXED_ASSET;
      await this.postStep(
        tx,
        period,
        `${fixed ? 'KH' : 'PB'}-${monthCode(period.month)}`,
        `${fixed ? 'Khấu hao TSCĐ' : 'Phân bổ công cụ dụng cụ'} kỳ ${monthLabel(period.month)}`,
        fixed ? EntryKind.DEPRECIATION : EntryKind.ALLOCATION,
        [...[...byAccount].map(([account, v]) => ({ account, debit: v })), { account: fixed ? '214' : '242', credit: total }],
        actor,
      );
    }
    return `${charges.length} ${kind === AssetKind.FIXED_ASSET ? 'tài sản' : 'công cụ'} · ${vnd(total)}`;
  }

  private depreciation(tx: Tx, period: AccountingPeriod, actor: AuthUser) {
    return this.assetStep(tx, period, actor, AssetKind.FIXED_ASSET);
  }

  private allocation(tx: Tx, period: AccountingPeriod, actor: AuthUser) {
    return this.assetStep(tx, period, actor, AssetKind.TOOL);
  }

  /** 4. Offset input VAT (1331, including what was carried in) against output VAT (33311) */
  private async vat(tx: Tx, period: AccountingPeriod, actor: AuthUser): Promise<string> {
    const { closing } = await this.figures.balances(tx, period.id);
    const output = -(closing.get('33311') ?? 0n);
    const input = closing.get('1331') ?? 0n;
    const off = output > 0n && input > 0n ? (output < input ? output : input) : 0n;
    if (off > 0n) {
      await this.postStep(tx, period, `KT-${monthCode(period.month)}`, `Khấu trừ thuế GTGT kỳ ${monthLabel(period.month)}`, EntryKind.VAT_OFFSET, [{ account: '33311', debit: off }, { account: '1331', credit: off }], actor);
    }
    return `đầu ra ${vnd(output)} · đầu vào ${vnd(input)} · khấu trừ ${vnd(off)}`;
  }

  /** 5. Production overhead to cost of goods, revenue and expenses to 911, result to 421 */
  private async transfer(tx: Tx, period: AccountingPeriod, actor: AuthUser): Promise<string> {
    const code = monthCode(period.month);
    const label = monthLabel(period.month);
    let lines = await this.figures.movements(tx, period.id);
    const overhead = overheadOf(lines);
    if (overhead > 0n) {
      await this.postStep(tx, period, `KC-${code}-01`, 'Kết chuyển chi phí sản xuất chung vào giá vốn', EntryKind.CLOSING, [{ account: '632', debit: overhead }, { account: '154', credit: overhead }], actor);
      lines = await this.figures.movements(tx, period.id);
    }
    const rev = REVENUE_ACCOUNTS.map((a) => ({ account: a, v: netCredit(lines, a) })).filter((x) => x.v !== 0n);
    const exp = EXPENSE_ACCOUNTS.map((a) => ({ account: a, v: -netCredit(lines, a) })).filter((x) => x.v !== 0n);
    const revTotal = rev.reduce((s, x) => s + x.v, 0n);
    const expTotal = exp.reduce((s, x) => s + x.v, 0n);
    // A negative net on an account (refunds bigger than sales, say) flips its side.
    const side = (account: string, v: bigint, debitWhenPositive: boolean): PostLine => (v > 0n === debitWhenPositive ? { account, debit: v > 0n ? v : -v } : { account, credit: v > 0n ? v : -v });
    if (rev.length) {
      await this.postStep(tx, period, `KC-${code}-02`, 'Kết chuyển doanh thu và thu nhập', EntryKind.CLOSING, [...rev.map((x) => side(x.account, x.v, true)), side('911', revTotal, false)], actor);
    }
    if (exp.length) {
      await this.postStep(tx, period, `KC-${code}-03`, 'Kết chuyển giá vốn và chi phí', EntryKind.CLOSING, [side('911', expTotal, true), ...exp.map((x) => side(x.account, x.v, false))], actor);
    }
    const profit = revTotal - expTotal;
    if (profit !== 0n) {
      await this.postStep(
        tx,
        period,
        `KC-${code}-04`,
        `${profit > 0n ? 'Kết chuyển lãi' : 'Kết chuyển lỗ'} kỳ ${label}`,
        EntryKind.CLOSING,
        profit > 0n ? [{ account: '911', debit: profit }, { account: '421', credit: profit }] : [{ account: '421', debit: -profit }, { account: '911', credit: -profit }],
        actor,
      );
    }
    return `${profit >= 0n ? 'lãi' : 'lỗ'} ${vnd(profit >= 0n ? profit : -profit)}`;
  }

  // ───────────── Close / reopen ─────────────

  async close(periodId: string, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.books.lock(tx);
      const period = await this.books.period(tx, periodId);
      this.books.assertOpen(period);
      if (await this.previousOpen(tx, period)) throw DomainError.conflict('PREVIOUS_PERIOD_OPEN', 'Close the earlier month first');
      const missing = STEPS.filter((s) => !period[STEP_COLUMN[s]]);
      if (missing.length) throw DomainError.conflict('STEPS_PENDING', `Run the month-end steps first: ${missing.map((s) => STEP_LABEL[s]).join(', ')}`, { steps: missing });

      const { lines, closing } = await this.figures.balances(tx, period.id);
      const stock = await this.figures.stock(tx, period);
      const parts = profitOf(lines, true);
      await tx.accountingPeriod.update({
        where: { id: period.id },
        data: {
          status: PeriodStatus.CLOSED,
          closedAt: new Date(),
          closedById: actor.id,
          revenueVnd: parts.revenue,
          cogsVnd: parts.cogs,
          sellingVnd: parts.selling,
          adminVnd: parts.admin,
          otherNetVnd: parts.otherNet,
        },
      });

      // Carry balances and stock into the next month
      const next = await this.books.ensureMonth(tx, nextMonth(period.month));
      await tx.periodOpening.deleteMany({ where: { periodId: next.id } });
      const carry = [...closing].filter(([, v]) => v !== 0n);
      if (carry.length) await tx.periodOpening.createMany({ data: carry.map(([accountCode, balanceVnd]) => ({ periodId: next.id, accountCode, balanceVnd })) });
      await tx.materialOpening.deleteMany({ where: { periodId: next.id } });
      const stockCarry = stock.filter((s) => s.endQty !== 0 || s.endValue !== 0n);
      if (stockCarry.length) {
        await tx.materialOpening.createMany({
          data: stockCarry.map((s) => ({ periodId: next.id, materialId: s.materialId, qty: s.endQty.toFixed(3), priceVnd: s.endQty > 0 ? s.average : 0n })),
        });
      }
      if (next.status === PeriodStatus.OPEN) await this.books.invalidateSteps(tx, next, actor.id, `Số dư đầu kỳ thay đổi khi khoá sổ ${monthLabel(period.month)}`);
      await this.books.log(tx, period.id, 'PERIOD_CLOSED', actor.id, { revenue: String(parts.revenue), profit: String(parts.profit) }, monthLabel(period.month));
    });
  }

  async reopen(periodId: string, reason: string, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.books.lock(tx);
      const period = await this.books.period(tx, periodId);
      if (period.status !== PeriodStatus.CLOSED) throw DomainError.conflict('PERIOD_NOT_CLOSED', `${monthLabel(period.month)} is not closed`);
      const laterClosed = await tx.accountingPeriod.count({ where: { month: { gt: period.month }, status: PeriodStatus.CLOSED } });
      if (laterClosed) throw DomainError.conflict('LATER_PERIOD_CLOSED', 'Reopen the later months first');
      await tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: PeriodStatus.OPEN, closedAt: null, closedById: null, revenueVnd: null, cogsVnd: null, sellingVnd: null, adminVnd: null, otherNetVnd: null },
      });
      await this.books.invalidateSteps(tx, { ...period, status: PeriodStatus.OPEN }, actor.id, `Mở lại kỳ: ${reason.trim()}`);
      await this.books.log(tx, period.id, 'PERIOD_REOPENED', actor.id, { reason: reason.trim() }, monthLabel(period.month));
    });
  }

  stepLabel(step: Step): string {
    return STEP_LABEL[step];
  }
}
