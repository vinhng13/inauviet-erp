import { Injectable } from '@nestjs/common';
import type { AccountingPeriod } from '../generated/prisma/client';
import { AssetKind, EntryKind } from '../generated/prisma/enums';
import type { Tx } from '../prisma/prisma.service';
import { applyLines, chargedThrough, monthlyCharge, profitOf, valueOf, weightedAverage, type LineLike, type ProfitParts } from './ledger';

export interface MovementLine extends LineLike {
  kind: EntryKind;
  entryId: string;
  orderId: string | null;
}

export interface StockFigure {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  isActive: boolean;
  openQty: number;
  openPrice: bigint;
  inQty: number;
  inValue: bigint;
  outQty: number;
  /** Weighted average of the month */
  average: bigint;
  /** Price issues use now: the average once priced, otherwise the provisional price */
  price: bigint;
  outValue: bigint;
  endQty: number;
  endValue: bigint;
}

const qty = (d: { toString(): string }) => Number(d.toString());

/** Figures read from the books for one period, shared by month-end steps and reports. */
@Injectable()
export class FiguresService {
  async openings(tx: Tx, periodId: string): Promise<Map<string, bigint>> {
    const rows = await tx.periodOpening.findMany({ where: { periodId } });
    return new Map(rows.map((r) => [r.accountCode, r.balanceVnd]));
  }

  async movements(tx: Tx, periodId: string): Promise<MovementLine[]> {
    const rows = await tx.journalLine.findMany({
      where: { entry: { periodId } },
      select: { accountCode: true, debitVnd: true, creditVnd: true, entryId: true, entry: { select: { kind: true, orderId: true } } },
    });
    return rows.map((r) => ({ accountCode: r.accountCode, debitVnd: r.debitVnd, creditVnd: r.creditVnd, entryId: r.entryId, kind: r.entry.kind, orderId: r.entry.orderId }));
  }

  async balances(tx: Tx, periodId: string): Promise<{ opening: Map<string, bigint>; lines: MovementLine[]; closing: Map<string, bigint> }> {
    const opening = await this.openings(tx, periodId);
    const lines = await this.movements(tx, periodId);
    return { opening, lines, closing: applyLines(opening, lines) };
  }

  /** Profit of an open month so far (production overhead in 154 counted as cost until transferred) */
  async profit(tx: Tx, period: AccountingPeriod): Promise<ProfitParts & { provisional: boolean }> {
    if (period.status === 'CLOSED' && period.revenueVnd !== null) {
      const revenue = period.revenueVnd;
      const cogs = period.cogsVnd ?? 0n;
      const selling = period.sellingVnd ?? 0n;
      const admin = period.adminVnd ?? 0n;
      const otherNet = period.otherNetVnd ?? 0n;
      return { revenue, cogs, selling, admin, otherNet, profit: revenue - cogs - selling - admin + otherNet, provisional: false };
    }
    const lines: Array<MovementLine> = await this.movements(tx, period.id);
    // Depreciation and allocation not posted yet still belong to the month
    const pending = [...(period.depreciatedAt ? [] : [AssetKind.FIXED_ASSET]), ...(period.allocatedAt ? [] : [AssetKind.TOOL])];
    for (const kind of pending) {
      for (const c of await this.charges(tx, period.month, kind)) {
        if (c.monthly > 0n) lines.push({ accountCode: c.asset.expenseAccount, debitVnd: c.monthly, creditVnd: 0n, kind: kind === AssetKind.TOOL ? EntryKind.ALLOCATION : EntryKind.DEPRECIATION, entryId: '', orderId: null });
      }
    }
    // Closing entries (KC-01 included) are left out, so 154 overhead always counts as cost of goods here
    return { ...profitOf(lines, true), provisional: true };
  }

  /**
   * Stock of every material for the month: opening, received, issued, monthly weighted average.
   * Before pricing, issues use the provisional price stored on their lines.
   */
  async stock(tx: Tx, period: AccountingPeriod): Promise<StockFigure[]> {
    const [materials, openings, receiptLines, issueLines] = await Promise.all([
      tx.material.findMany({ orderBy: { code: 'asc' } }),
      tx.materialOpening.findMany({ where: { periodId: period.id } }),
      tx.stockReceiptLine.findMany({ where: { receipt: { periodId: period.id } } }),
      tx.stockIssueLine.findMany({ where: { issue: { periodId: period.id } } }),
    ]);
    const open = new Map(openings.map((o) => [o.materialId, o]));
    const out: StockFigure[] = [];
    for (const m of materials) {
      const o = open.get(m.id);
      const openQty = o ? qty(o.qty) : 0;
      const openPrice = o?.priceVnd ?? 0n;
      const rec = receiptLines.filter((l) => l.materialId === m.id);
      const iss = issueLines.filter((l) => l.materialId === m.id);
      const inQty = rec.reduce((s, l) => s + qty(l.qty), 0);
      const inValue = rec.reduce((s, l) => s + valueOf(qty(l.qty), l.priceVnd), 0n);
      const outQty = iss.reduce((s, l) => s + qty(l.qty), 0);
      const average = weightedAverage(openQty, openPrice, inQty, inValue);
      const outValue = iss.reduce((s, l) => s + valueOf(qty(l.qty), period.pricedAt ? average : l.priceVnd), 0n);
      const endQty = Math.round((openQty + inQty - outQty) * 1000) / 1000;
      if (!o && !rec.length && !iss.length && !m.isActive) continue;
      out.push({
        materialId: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        isActive: m.isActive,
        openQty,
        openPrice,
        inQty,
        inValue,
        outQty,
        average,
        price: period.pricedAt ? average : this.provisional(openQty, openPrice, rec),
        outValue,
        endQty,
        endValue: valueOf(openQty, openPrice) + inValue - outValue,
      });
    }
    return out;
  }

  /** Price for an issue before the month is priced: the average of what is known so far */
  provisional(openQty: number, openPrice: bigint, receipts: Array<{ qty: { toString(): string }; priceVnd: bigint }>): bigint {
    const inQty = receipts.reduce((s, l) => s + qty(l.qty), 0);
    const inValue = receipts.reduce((s, l) => s + valueOf(qty(l.qty), l.priceVnd), 0n);
    return weightedAverage(openQty, openPrice, inQty, inValue);
  }

  /** Depreciation / allocation of each asset for the month */
  async charges(tx: Tx, month: string, kind: AssetKind) {
    const assets = await tx.fixedAsset.findMany({ where: { kind }, orderBy: { code: 'asc' } });
    return assets.map((a) => ({
      asset: a,
      monthly: monthlyCharge(a.costVnd, a.months, a.startMonth, month),
      chargedBefore: chargedThrough(a.costVnd, a.months, a.startMonth, month, false),
    }));
  }
}
