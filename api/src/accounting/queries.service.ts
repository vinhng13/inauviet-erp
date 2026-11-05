import { Injectable } from '@nestjs/common';
import type { AccountingPeriod } from '../generated/prisma/client';
import { AssetKind, EntryKind, OrderStatus, PeriodStatus } from '../generated/prisma/enums';
import { DomainError } from '../common/errors/domain-error';
import { addDays, formatDateOnly } from '../common/utils/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type {
  AssetRowDto,
  AssetsDto,
  CashBookDto,
  DebtsDto,
  GlDto,
  JournalDto,
  JournalEntryDto,
  JournalLineDto,
  LedgerAccountDto,
  MaterialDto,
  OpeningsDto,
  OverviewDto,
  PeriodDto,
  PeriodLogDto,
  PeriodsDto,
  PnlDto,
  StockDto,
  SupplierDto,
  TaxDto,
  TaxRowDto,
  TrialBalanceRowDto,
  CategorySumDto,
} from './accounting.dto';
import { BooksService, STEP_KINDS } from './books.service';
import { ClosingService } from './closing.service';
import { FiguresService } from './figures.service';
import { STEP_COLUMN, STEPS, chargedThrough, monthLabel, monthsBetween, vnd } from './ledger';
import { CrmSyncService, SOURCE } from './sync.service';

const n = (v: bigint | null | undefined) => Number(v ?? 0n);
const CRM_SOURCES: string[] = [SOURCE.payment, SOURCE.paymentVoid, SOURCE.revenue];

const ACTION_TEXT: Record<string, string> = {
  BOOKS_STARTED: 'Bắt đầu sổ sách từ kỳ',
  OPENINGS_SAVED: 'Lưu số dư đầu kỳ',
  STOCK_OPENINGS_SAVED: 'Lưu tồn kho đầu kỳ',
  STEP_RUN: 'Chạy bước',
  STEPS_RESET: 'Các bước cuối kỳ cần chạy lại',
  PERIOD_CLOSED: 'Khoá sổ kỳ',
  PERIOD_REOPENED: 'Mở lại kỳ',
  ENTRY_EDITED: 'Sửa bút toán',
  ENTRY_DELETED: 'Xoá chứng từ',
};

/** Read models for the accounting screens. Every read first brings in what the CRM recorded. */
@Injectable()
export class QueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly figures: FiguresService,
    private readonly closing: ClosingService,
    private readonly sync: CrmSyncService,
  ) {}

  private async read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    await this.sync.sync();
    return this.prisma.$transaction(fn, { timeout: 30_000 });
  }

  private async periodOf(tx: Tx, id: string): Promise<AccountingPeriod> {
    return this.books.period(tx, id);
  }

  // ───────────── Periods ─────────────

  async accounts(): Promise<LedgerAccountDto[]> {
    const rows = await this.prisma.ledgerAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return rows.map((a) => ({ code: a.code, name: a.name, isCredit: a.isCredit }));
  }

  private async periodDto(tx: Tx, p: AccountingPeriod, all: AccountingPeriod[]): Promise<PeriodDto> {
    const profit = await this.figures.profit(tx, p);
    const closer = p.closedById ? await tx.user.findUnique({ where: { id: p.closedById }, select: { fullName: true } }) : null;
    return {
      id: p.id,
      month: p.month,
      status: p.status,
      stepsDone: STEPS.filter((s) => p[STEP_COLUMN[s]] !== null),
      closedAt: p.closedAt?.toISOString() ?? null,
      closedByName: closer?.fullName ?? null,
      revenueVnd: n(profit.revenue),
      profitVnd: n(profit.profit),
      provisional: profit.provisional,
      previousOpen: all.some((x) => x.month < p.month && x.status === PeriodStatus.OPEN),
      isFirst: all[0]?.id === p.id,
      canReopen: p.status === PeriodStatus.CLOSED && !all.some((x) => x.month > p.month && x.status === PeriodStatus.CLOSED),
    };
  }

  async periods(): Promise<PeriodsDto> {
    return this.read(async (tx) => {
      const all = await this.books.periods(tx);
      const periods = [];
      for (const p of [...all].reverse()) periods.push(await this.periodDto(tx, p, all));
      const logs = await tx.activityLog.findMany({ where: { entityType: 'PERIOD' }, orderBy: { createdAt: 'desc' }, take: 60, include: { user: { select: { fullName: true } } } });
      const monthOf = new Map(all.map((p) => [p.id, p.month]));
      const log: PeriodLogDto[] = logs.map((l) => {
        const data = (l.data ?? {}) as Record<string, unknown>;
        const month = monthOf.get(l.entityId);
        const detail =
          l.action === 'STEP_RUN'
            ? `"${this.closing.stepLabel(data.step as (typeof STEPS)[number])}" — ${String(data.summary ?? '')}`
            : l.action === 'STEPS_RESET' || l.action === 'PERIOD_REOPENED'
              ? String(data.reason ?? '')
              : l.action === 'ENTRY_EDITED'
                ? `${l.toValue ?? ''}${data.reason ? ` — ${String(data.reason)}` : ''}`
                : (l.toValue ?? '');
        return {
          id: l.id,
          action: l.action,
          text: `${ACTION_TEXT[l.action] ?? l.action}${month ? ` ${monthLabel(month)}` : ''}${detail ? `: ${detail}` : ''}`,
          userName: l.user?.fullName ?? null,
          createdAt: l.createdAt.toISOString(),
        };
      });
      return { periods, log };
    });
  }

  // ───────────── Overview ─────────────

  async overview(periodId: string): Promise<OverviewDto> {
    return this.read(async (tx) => {
      const all = await this.books.periods(tx);
      const p = await this.periodOf(tx, periodId);
      const period = await this.periodDto(tx, p, all);
      const { closing } = await this.figures.balances(tx, p.id);
      const bal = (a: string) => closing.get(a) ?? 0n;
      const open = p.status === PeriodStatus.OPEN && !period.previousOpen;
      const steps = [];
      let earlierDone = true;
      for (const s of STEPS) {
        const doneAt = p[STEP_COLUMN[s]];
        steps.push({ step: s, done: doneAt !== null, doneAt: doneAt?.toISOString() ?? null, summary: await this.stepSummary(tx, p, s), canRun: open && earlierDone && doneAt === null });
        earlierDone = earlierDone && doneAt !== null;
      }
      // Orders in production or later with no material issued: their cost of goods would be 0
      const issued = new Set((await tx.stockIssue.findMany({ where: { orderId: { not: null } }, select: { orderId: true } })).map((i) => i.orderId!));
      const orders = await tx.order.findMany({
        where: { productionCode: { not: null }, status: { in: [OrderStatus.IN_PRODUCTION, OrderStatus.DELIVERING, OrderStatus.COMPLETED] }, OR: [{ acceptedAt: null }, { acceptedAt: { gte: new Date(`${all[0].month}-01T00:00:00Z`) } }] },
        select: { id: true, code: true, productionCode: true, status: true, customer: { select: { name: true } }, lines: { select: { description: true }, take: 2 } },
        orderBy: { productionStartedAt: 'asc' },
        take: 30,
      });
      const pendingIssues = orders
        .filter((o) => !issued.has(o.id))
        .map((o) => ({ orderId: o.id, orderCode: o.code, productionCode: o.productionCode, customerName: o.customer.name, summary: o.lines.map((l) => l.description).join(', ') }));
      return {
        period,
        kpi: { cashVnd: n(bal('111')), bankVnd: n(bal('112')), receivableVnd: n(bal('131')), payableVnd: n(-bal('331')), stockVnd: n(bal('152')), profitVnd: period.profitVnd },
        steps,
        canClose: open && STEPS.every((s) => p[STEP_COLUMN[s]] !== null),
        pendingIssues,
      };
    });
  }

  private async stepSummary(tx: Tx, p: AccountingPeriod, step: (typeof STEPS)[number]): Promise<string> {
    const posted = async (kinds: EntryKind[]) =>
      (await tx.journalLine.aggregate({ where: { entry: { periodId: p.id, kind: { in: kinds } } }, _sum: { debitVnd: true } }))._sum.debitVnd ?? 0n;
    if (step === 'price') {
      const issues = await tx.stockIssue.count({ where: { periodId: p.id } });
      return p.pricedAt ? `${issues} phiếu xuất · giá vốn ${vnd(await posted([EntryKind.COGS]))}` : `${issues} phiếu xuất chờ tính giá bình quân`;
    }
    if (step === 'depreciation' || step === 'allocation') {
      const kind = step === 'depreciation' ? AssetKind.FIXED_ASSET : AssetKind.TOOL;
      const charges = (await this.figures.charges(tx, p.month, kind)).filter((c) => c.monthly > 0n);
      const total = charges.reduce((s, c) => s + c.monthly, 0n);
      return `${step === 'depreciation' ? 'Khấu hao' : 'Phân bổ'} ${vnd(total)} · ${charges.length} ${step === 'depreciation' ? 'tài sản' : 'công cụ'}`;
    }
    if (step === 'vat') {
      if (p.vatOffsetAt) return `Khấu trừ ${vnd(await posted([EntryKind.VAT_OFFSET]))}`;
      const { closing } = await this.figures.balances(tx, p.id);
      return `Đầu ra ${vnd(-(closing.get('33311') ?? 0n))} · đầu vào ${vnd(closing.get('1331') ?? 0n)}`;
    }
    const profit = await this.figures.profit(tx, p);
    return `${profit.profit >= 0n ? 'Lãi' : 'Lỗ'} ${vnd(profit.profit >= 0n ? profit.profit : -profit.profit)}${profit.provisional && !p.transferredAt ? ' (tạm tính)' : ''}`;
  }

  // ───────────── Journal ─────────────

  async journal(periodId: string): Promise<JournalDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const names = await this.accountNames(tx);
      const entries = await tx.journalEntry.findMany({
        where: { periodId: p.id },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      const orderIds = [...new Set(entries.map((e) => e.orderId).filter((x): x is string => !!x))];
      const orders = new Map((await tx.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true } })).map((o) => [o.id, o.code]));
      const editorIds = [...new Set(entries.map((e) => e.editedById).filter((x): x is string => !!x))];
      const editors = new Map((await tx.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const open = p.status === PeriodStatus.OPEN;
      const line = (account: string, debit: bigint, credit: bigint): JournalLineDto => ({ account, accountName: names.get(account) ?? account, debitVnd: n(debit), creditVnd: n(credit) });
      const list: JournalEntryDto[] = entries.map((e) => {
        const step = STEP_KINDS.includes(e.kind);
        const original = Array.isArray(e.originalLines) ? (e.originalLines as Array<{ account: string; debitVnd: string; creditVnd: string }>) : null;
        return {
          id: e.id,
          code: e.code,
          date: formatDateOnly(e.date),
          description: e.description,
          kind: e.kind,
          source: e.source,
          edited: !!original,
          editReason: e.editReason,
          editedByName: e.editedById ? (editors.get(e.editedById) ?? null) : null,
          originalLines: original ? original.map((l) => line(l.account, BigInt(l.debitVnd), BigInt(l.creditVnd))) : null,
          note: e.note,
          orderCode: e.orderId ? (orders.get(e.orderId) ?? null) : null,
          lines: e.lines.map((l) => line(l.accountCode, l.debitVnd, l.creditVnd)),
          totalVnd: n(e.lines.reduce((s, l) => s + l.debitVnd, 0n)),
          canEdit: open && !step,
          canDelete: open && !step && !(e.sourceType && CRM_SOURCES.includes(e.sourceType)),
        };
      });
      return { entries: list, trialBalance: await this.trialBalance(tx, p, names) };
    });
  }

  private async accountNames(tx: Tx): Promise<Map<string, string>> {
    return new Map((await tx.ledgerAccount.findMany({ select: { code: true, name: true } })).map((a) => [a.code, a.name]));
  }

  private async trialBalance(tx: Tx, p: AccountingPeriod, names: Map<string, string>): Promise<TrialBalanceRowDto[]> {
    const { opening, lines, closing } = await this.figures.balances(tx, p.id);
    const accounts = await tx.ledgerAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return accounts
      .map((a) => {
        const debit = lines.reduce((s, l) => (l.accountCode === a.code ? s + l.debitVnd : s), 0n);
        const credit = lines.reduce((s, l) => (l.accountCode === a.code ? s + l.creditVnd : s), 0n);
        return { account: a.code, name: names.get(a.code) ?? a.code, openingVnd: n(opening.get(a.code)), debitVnd: n(debit), creditVnd: n(credit), closingVnd: n(closing.get(a.code)) };
      })
      .filter((r) => r.openingVnd || r.debitVnd || r.creditVnd || r.closingVnd);
  }

  // ───────────── Openings ─────────────

  async openings(): Promise<OpeningsDto> {
    return this.read(async (tx) => {
      const first = await tx.accountingPeriod.findFirst({ orderBy: { month: 'asc' } });
      if (!first) throw DomainError.conflict('BOOKS_NOT_STARTED', 'Set up the first accounting period first');
      const opening = await this.figures.openings(tx, first.id);
      const accounts = await tx.ledgerAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
      const lines = accounts.map((a) => {
        const v = opening.get(a.code) ?? 0n;
        return { account: a.code, name: a.name, openingVnd: n(v), debitVnd: v > 0n ? n(v) : 0, creditVnd: v < 0n ? n(-v) : 0, closingVnd: n(v) };
      });
      const diff = [...opening.values()].reduce((s, v) => s + v, 0n);
      return { lines, differenceVnd: n(diff), editable: first.status === PeriodStatus.OPEN };
    });
  }

  // ───────────── Cash book ─────────────

  async cashBook(periodId: string, account: 'all' | '111' | '112' = 'all'): Promise<CashBookDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const accounts = account === 'all' ? ['111', '112'] : [account];
      const opening = await this.figures.openings(tx, p.id);
      const openingVnd = accounts.reduce((s, a) => s + (opening.get(a) ?? 0n), 0n);
      const lines = await tx.journalLine.findMany({
        where: { accountCode: { in: accounts }, entry: { periodId: p.id } },
        include: { entry: { select: { id: true, code: true, date: true, description: true, orderId: true, createdAt: true } } },
      });
      lines.sort((a, b) => a.entry.date.getTime() - b.entry.date.getTime() || a.entry.createdAt.getTime() - b.entry.createdAt.getTime() || a.sortOrder - b.sortOrder);
      const orderIds = [...new Set(lines.map((l) => l.entry.orderId).filter((x): x is string => !!x))];
      const orders = new Map((await tx.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true } })).map((o) => [o.id, o.code]));
      let balance = openingVnd;
      let inVnd = 0n;
      let outVnd = 0n;
      const rows = lines.map((l) => {
        balance += l.debitVnd - l.creditVnd;
        inVnd += l.debitVnd;
        outVnd += l.creditVnd;
        return {
          entryId: l.entry.id,
          code: l.entry.code,
          date: formatDateOnly(l.entry.date),
          description: l.entry.description,
          account: l.accountCode,
          inVnd: n(l.debitVnd),
          outVnd: n(l.creditVnd),
          balanceVnd: n(balance),
          orderCode: l.entry.orderId ? (orders.get(l.entry.orderId) ?? null) : null,
        };
      });
      const cats = await tx.expenseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      const sums = await tx.cashPayment.groupBy({ by: ['categoryId'], where: { periodId: p.id, categoryId: { not: null } }, _sum: { amountVnd: true } });
      const categories: CategorySumDto[] = cats.map((c) => ({
        id: c.id,
        name: c.name,
        split: c.split as unknown as CategorySumDto['split'],
        isActive: c.isActive,
        amountVnd: n(sums.find((s) => s.categoryId === c.id)?._sum.amountVnd),
      }));
      return { openingVnd: n(openingVnd), closingVnd: n(balance), inVnd: n(inVnd), outVnd: n(outVnd), rows, categories };
    });
  }

  // ───────────── Debts ─────────────

  /** Receivables by customer and payables by supplier as at the end of the month (all months up to it) */
  async debts(periodId: string): Promise<DebtsDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const first = (await tx.accountingPeriod.findFirst({ orderBy: { month: 'asc' } }))!;
      const firstOpening = await this.figures.openings(tx, first.id);
      const lines = await tx.journalLine.findMany({
        where: { accountCode: { in: ['131', '331'] }, entry: { period: { month: { lte: p.month } } } },
        include: { entry: { select: { date: true, customerId: true, supplierId: true } } },
      });
      // Receivables: FIFO so the oldest unpaid revenue date is known
      const byCustomer = new Map<string | null, Array<{ date: string; debit: bigint; credit: bigint }>>();
      const opening131 = firstOpening.get('131') ?? 0n;
      if (opening131 !== 0n) byCustomer.set(null, [{ date: `${first.month}-01`, debit: opening131 > 0n ? opening131 : 0n, credit: opening131 < 0n ? -opening131 : 0n }]);
      for (const l of lines.filter((x) => x.accountCode === '131')) {
        const key = l.entry.customerId;
        if (!byCustomer.has(key)) byCustomer.set(key, []);
        byCustomer.get(key)!.push({ date: formatDateOnly(l.entry.date), debit: l.debitVnd, credit: l.creditVnd });
      }
      const custIds = [...byCustomer.keys()].filter((x): x is string => !!x);
      const customers = new Map((await tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const monthEnd = `${p.month}-31`;
      const receivables = [...byCustomer].map(([customerId, moves]) => {
        const balance = moves.reduce((s, m) => s + m.debit - m.credit, 0n);
        let paid = moves.reduce((s, m) => s + m.credit, 0n);
        let oldest: string | null = null;
        for (const m of [...moves].filter((x) => x.debit > 0n).sort((a, b) => a.date.localeCompare(b.date))) {
          if (paid >= m.debit) {
            paid -= m.debit;
            continue;
          }
          oldest = m.date;
          break;
        }
        if (balance <= 0n) oldest = null;
        return {
          customerId,
          customerName: customerId ? (customers.get(customerId) ?? '—') : 'Số dư đầu kỳ chưa phân theo khách',
          oweVnd: n(balance > 0n ? balance : 0n),
          advanceVnd: n(balance < 0n ? -balance : 0n),
          oldestDate: oldest,
          overdue30: !!oldest && addDays(oldest, 30) < monthEnd.slice(0, 10),
        };
      });
      const filteredRec = receivables.filter((r) => r.oweVnd || r.advanceVnd).sort((a, b) => b.oweVnd - a.oweVnd || b.advanceVnd - a.advanceVnd);

      const bySupplier = new Map<string | null, { bought: bigint; paid: bigint }>();
      const opening331 = -(firstOpening.get('331') ?? 0n);
      if (opening331 !== 0n) bySupplier.set(null, { bought: opening331, paid: 0n });
      for (const l of lines.filter((x) => x.accountCode === '331')) {
        const key = l.entry.supplierId;
        const cur = bySupplier.get(key) ?? { bought: 0n, paid: 0n };
        cur.bought += l.creditVnd;
        cur.paid += l.debitVnd;
        bySupplier.set(key, cur);
      }
      const supIds = [...bySupplier.keys()].filter((x): x is string => !!x);
      const suppliers = new Map((await tx.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
      const payables = [...bySupplier]
        .map(([supplierId, v]) => ({
          supplierId,
          supplierName: supplierId ? (suppliers.get(supplierId) ?? '—') : 'Số dư đầu kỳ chưa phân theo nhà cung cấp',
          boughtVnd: n(v.bought),
          paidVnd: n(v.paid),
          balanceVnd: n(v.bought - v.paid),
        }))
        .filter((r) => r.boughtVnd || r.paidVnd)
        .sort((a, b) => b.balanceVnd - a.balanceVnd);
      return {
        receivables: filteredRec,
        payables,
        receivableTotalVnd: filteredRec.reduce((s, r) => s + r.oweVnd - r.advanceVnd, 0),
        payableTotalVnd: payables.reduce((s, r) => s + r.balanceVnd, 0),
      };
    });
  }

  // ───────────── Stock ─────────────

  async stock(periodId: string): Promise<StockDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const figures = await this.figures.stock(tx, p);
      const receipts = await tx.stockReceipt.findMany({
        where: { periodId: p.id },
        include: { supplier: { select: { name: true } }, lines: { include: { material: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      const issues = await tx.stockIssue.findMany({ where: { periodId: p.id }, include: { lines: { include: { material: true }, orderBy: { sortOrder: 'asc' } } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
      const orderIds = [...new Set(issues.map((i) => i.orderId).filter((x): x is string => !!x))];
      const orders = new Map((await tx.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true, customer: { select: { name: true } } } })).map((o) => [o.id, o]));
      const line = (l: { materialId: string; material: { name: string; unit: string }; qty: { toString(): string }; priceVnd: bigint }) => {
        const qty = Number(l.qty.toString());
        const value = BigInt(Math.round(qty * 1000)) * l.priceVnd;
        return { materialId: l.materialId, materialName: l.material.name, unit: l.material.unit, qty, priceVnd: n(l.priceVnd), valueVnd: n((value + 500n) / 1000n) };
      };
      return {
        priced: p.pricedAt !== null,
        editable: p.status === PeriodStatus.OPEN,
        rows: figures.map((s) => ({
          materialId: s.materialId,
          code: s.code,
          name: s.name,
          unit: s.unit,
          openQty: s.openQty,
          openPriceVnd: n(s.openPrice),
          inQty: s.inQty,
          inVnd: n(s.inValue),
          outQty: s.outQty,
          outVnd: n(s.outValue),
          endQty: s.endQty,
          endVnd: n(s.endValue),
          priceVnd: n(s.price),
          isActive: s.isActive,
        })),
        receipts: receipts.map((r) => {
          const lines = r.lines.map(line);
          const value = lines.reduce((s, l) => s + l.valueVnd, 0);
          return {
            id: r.id,
            code: r.code,
            date: formatDateOnly(r.date),
            supplierId: r.supplierId,
            supplierName: r.supplier.name,
            payMethod: r.payMethod,
            vatRate: r.vatRate,
            valueVnd: value,
            vatVnd: Math.round((value * r.vatRate) / 100),
            note: r.note,
            lines,
          };
        }),
        issues: issues.map((i) => {
          const lines = i.lines.map(line);
          const o = i.orderId ? orders.get(i.orderId) : undefined;
          return {
            id: i.id,
            code: i.code,
            date: formatDateOnly(i.date),
            orderId: i.orderId,
            orderCode: o?.code ?? null,
            customerName: o?.customer.name ?? null,
            valueVnd: lines.reduce((s, l) => s + l.valueVnd, 0),
            note: i.note,
            lines,
          };
        }),
      };
    });
  }

  async suppliers(): Promise<SupplierDto[]> {
    const rows = await this.prisma.supplier.findMany({ orderBy: { code: 'asc' } });
    return rows.map((s) => ({ id: s.id, code: s.code, name: s.name, phone: s.phone, taxCode: s.taxCode, address: s.address, isActive: s.isActive }));
  }

  async materials(): Promise<MaterialDto[]> {
    const rows = await this.prisma.material.findMany({ orderBy: { code: 'asc' } });
    return rows.map((m) => ({ id: m.id, code: m.code, name: m.name, unit: m.unit, isActive: m.isActive }));
  }

  // ───────────── Tax ─────────────

  async tax(periodId: string): Promise<TaxDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const entries = await tx.journalEntry.findMany({
        where: { periodId: p.id, kind: { not: EntryKind.VAT_OFFSET }, lines: { some: { accountCode: { in: ['33311', '1331'] } } } },
        include: { lines: true },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      const output: TaxRowDto[] = [];
      const input: TaxRowDto[] = [];
      for (const e of entries) {
        const row = (base: bigint, vat: bigint): TaxRowDto => ({ entryId: e.id, code: e.code, date: formatDateOnly(e.date), description: e.description, baseVnd: n(base), vatVnd: n(vat) });
        const outVat = e.lines.reduce((s, l) => (l.accountCode === '33311' ? s + l.creditVnd - l.debitVnd : s), 0n);
        if (outVat !== 0n) output.push(row(e.lines.reduce((s, l) => (['511', '515', '711'].includes(l.accountCode) ? s + l.creditVnd - l.debitVnd : s), 0n), outVat));
        const inVat = e.lines.reduce((s, l) => (l.accountCode === '1331' ? s + l.debitVnd - l.creditVnd : s), 0n);
        if (inVat !== 0n) input.push(row(e.lines.reduce((s, l) => (l.accountCode !== '1331' ? s + l.debitVnd : s), 0n), inVat));
      }
      const opening = await this.figures.openings(tx, p.id);
      const carriedIn = opening.get('1331') ?? 0n;
      const outputVnd = output.reduce((s, r) => s + r.vatVnd, 0);
      const inputVnd = input.reduce((s, r) => s + r.vatVnd, 0);
      const net = outputVnd - inputVnd - n(carriedIn);
      return { output, input, outputVnd, inputVnd, carriedInVnd: n(carriedIn), payableVnd: net > 0 ? net : 0, carryForwardVnd: net < 0 ? -net : 0 };
    });
  }

  // ───────────── Assets ─────────────

  async assets(periodId: string): Promise<AssetsDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const rows = async (kind: AssetKind, stepDone: boolean): Promise<AssetRowDto[]> =>
        (await this.figures.charges(tx, p.month, kind)).map(({ asset: a, monthly }) => {
          const include = stepDone || p.status === PeriodStatus.CLOSED;
          const charged = chargedThrough(a.costVnd, a.months, a.startMonth, p.month, include);
          return {
            id: a.id,
            code: a.code,
            kind: a.kind,
            name: a.name,
            costVnd: n(a.costVnd),
            startMonth: a.startMonth,
            months: a.months,
            expenseAccount: a.expenseAccount,
            monthlyVnd: n(monthly),
            chargedVnd: n(charged),
            remainingVnd: n(a.costVnd - charged),
            monthsCharged: Math.min(a.months, Math.max(0, monthsBetween(a.startMonth, p.month) + (include ? 1 : 0))),
          };
        });
      const assets = await rows(AssetKind.FIXED_ASSET, p.depreciatedAt !== null);
      const tools = await rows(AssetKind.TOOL, p.allocatedAt !== null);
      return { assets, tools, depreciationVnd: assets.reduce((s, a) => s + a.monthlyVnd, 0), allocationVnd: tools.reduce((s, a) => s + a.monthlyVnd, 0) };
    });
  }

  // ───────────── Reports ─────────────

  /** Profit and loss for the last 6 months plus the year to date of the latest month */
  async pnl(): Promise<PnlDto> {
    return this.read(async (tx) => {
      const all = await this.books.periods(tx);
      const columns = [];
      const parts = [];
      for (const p of all) parts.push({ p, profit: await this.figures.profit(tx, p) });
      for (const { p, profit } of parts.slice(-6)) {
        columns.push({
          label: monthLabel(p.month),
          provisional: profit.provisional,
          revenueVnd: n(profit.revenue),
          cogsVnd: n(profit.cogs),
          sellingVnd: n(profit.selling),
          adminVnd: n(profit.admin),
          otherNetVnd: n(profit.otherNet),
          profitVnd: n(profit.profit),
        });
      }
      const last = all.at(-1);
      if (last) {
        const ytd = parts.filter((x) => x.p.month.slice(0, 4) === last.month.slice(0, 4));
        const sum = (k: 'revenue' | 'cogs' | 'selling' | 'admin' | 'otherNet' | 'profit') => n(ytd.reduce((s, x) => s + x.profit[k], 0n));
        columns.push({
          label: `Luỹ kế ${last.month.slice(0, 4)}`,
          provisional: ytd.some((x) => x.profit.provisional),
          revenueVnd: sum('revenue'),
          cogsVnd: sum('cogs'),
          sellingVnd: sum('selling'),
          adminVnd: sum('admin'),
          otherNetVnd: sum('otherNet'),
          profitVnd: sum('profit'),
        });
      }
      return { columns };
    });
  }

  async generalLedger(periodId: string, account: string): Promise<GlDto> {
    return this.read(async (tx) => {
      const p = await this.periodOf(tx, periodId);
      const acc = await tx.ledgerAccount.findUnique({ where: { code: account } });
      if (!acc) throw DomainError.badRequest('ACCOUNT_UNKNOWN', `Unknown account: ${account}`, { accounts: [account] });
      const { opening, lines } = await this.figures.balances(tx, p.id);
      const entries = await tx.journalEntry.findMany({
        where: { periodId: p.id, lines: { some: { accountCode: account } } },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      const openingVnd = opening.get(account) ?? 0n;
      let balance = openingVnd;
      let debit = 0n;
      let credit = 0n;
      const rows = [];
      for (const e of entries) {
        for (const l of e.lines.filter((x) => x.accountCode === account)) {
          const contraSide = e.lines.filter((x) => x.accountCode !== account && (l.debitVnd > 0n ? x.creditVnd > 0n : x.debitVnd > 0n));
          balance += l.debitVnd - l.creditVnd;
          debit += l.debitVnd;
          credit += l.creditVnd;
          rows.push({
            entryId: e.id,
            code: e.code,
            date: formatDateOnly(e.date),
            description: e.description,
            contra: [...new Set(contraSide.map((x) => x.accountCode))].join(', '),
            debitVnd: n(l.debitVnd),
            creditVnd: n(l.creditVnd),
            balanceVnd: n(balance),
          });
        }
      }
      const used = new Set([...[...opening].filter(([, v]) => v !== 0n).map(([k]) => k), ...lines.map((l) => l.accountCode)]);
      const accounts = await tx.ledgerAccount.findMany({ where: { code: { in: [...used] } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
      return {
        account: acc.code,
        name: acc.name,
        isCredit: acc.isCredit,
        openingVnd: n(openingVnd),
        debitVnd: n(debit),
        creditVnd: n(credit),
        closingVnd: n(balance),
        rows,
        usedAccounts: accounts.map((a) => ({ code: a.code, name: a.name, isCredit: a.isCredit })),
      };
    });
  }
}
