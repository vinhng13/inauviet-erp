import { Injectable } from '@nestjs/common';
import type { AccountingPeriod, Prisma } from '../generated/prisma/client';
import { AssetKind, EntryKind, EntrySource, PayMethod, PeriodStatus } from '../generated/prisma/enums';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { parseDateOnly } from '../common/utils/dates';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type {
  CreateAssetDto,
  CreateCashPaymentDto,
  CreateIssueDto,
  CreateManualEntryDto,
  CreateReceiptDto,
  EntryLineInputDto,
  SaveCategoryDto,
  SaveMaterialDto,
  SaveOpeningsDto,
  SaveStockOpeningsDto,
  SaveSupplierDto,
  UpdateEntryDto,
} from './accounting.dto';
import { BooksService, STEP_KINDS, type PostLine } from './books.service';
import { FiguresService } from './figures.service';
import { COST_ACCOUNTS, isBalanced, isMonth, monthLabel, splitAmount, valueOf, vatOf } from './ledger';
import { CrmSyncService, SOURCE } from './sync.service';

const payAccount = (m: PayMethod) => (m === PayMethod.CASH ? '111' : m === PayMethod.BANK ? '112' : '331');
const CRM_SOURCES: string[] = [SOURCE.payment, SOURCE.paymentVoid, SOURCE.revenue];
const qtyOf = (d: { toString(): string }) => Number(d.toString());

/** Everything the accountant enters: first-period setup, catalogs and vouchers. Each voucher posts its entry. */
@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly figures: FiguresService,
    private readonly sync: CrmSyncService,
    private readonly numbering: NumberingService,
  ) {}

  syncNow(): Promise<number> {
    return this.sync.sync();
  }

  /** Writes go through one transaction holding the books lock, after bringing in what the CRM recorded. */
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    await this.sync.sync();
    return this.prisma.$transaction(async (tx) => {
      await this.books.lock(tx);
      return fn(tx);
    });
  }

  // ───────────── First period ─────────────

  async start(month: string, actor: AuthUser): Promise<string> {
    if (!isMonth(month)) throw DomainError.badRequest('INVALID_MONTH', 'Month must be YYYY-MM');
    return this.prisma.$transaction(async (tx) => {
      await this.books.lock(tx);
      if (await tx.accountingPeriod.count()) throw DomainError.conflict('BOOKS_STARTED', 'The books are already started');
      const p = await tx.accountingPeriod.create({ data: { month } });
      await this.books.log(tx, p.id, 'BOOKS_STARTED', actor.id, { month }, monthLabel(month));
      return p.id;
    });
  }

  /** Openings can be changed while the first month is open */
  private async firstOpen(tx: Tx): Promise<AccountingPeriod> {
    const first = await tx.accountingPeriod.findFirst({ orderBy: { month: 'asc' } });
    if (!first) throw DomainError.conflict('BOOKS_NOT_STARTED', 'Set up the first accounting period first');
    if (first.status !== PeriodStatus.OPEN) throw DomainError.conflict('OPENINGS_LOCKED', 'Opening balances are locked once the first month is closed');
    return first;
  }

  async saveOpenings(dto: SaveOpeningsDto, actor: AuthUser): Promise<void> {
    await this.write(async (tx) => {
      const first = await this.firstOpen(tx);
      const rows = dto.lines
        .filter((l) => l.account !== '152')
        .map((l) => ({ accountCode: l.account.trim(), balanceVnd: BigInt(l.debitVnd) - BigInt(l.creditVnd) }))
        .filter((l) => l.balanceVnd !== 0n);
      const codes = rows.map((r) => r.accountCode);
      if (new Set(codes).size !== codes.length) throw DomainError.badRequest('ACCOUNT_DUPLICATE', 'Each account can appear once');
      await this.books.assertAccounts(tx, codes);
      await tx.periodOpening.deleteMany({ where: { periodId: first.id, accountCode: { not: '152' } } });
      if (rows.length) await tx.periodOpening.createMany({ data: rows.map((r) => ({ ...r, periodId: first.id })) });
      await this.books.invalidateSteps(tx, first, actor.id, 'Sửa số dư đầu kỳ');
      await this.books.log(tx, first.id, 'OPENINGS_SAVED', actor.id, { accounts: rows.length });
    });
  }

  async saveStockOpenings(dto: SaveStockOpeningsDto, actor: AuthUser): Promise<void> {
    await this.write(async (tx) => {
      const first = await this.firstOpen(tx);
      const ids = dto.lines.map((l) => l.materialId);
      if (new Set(ids).size !== ids.length) throw DomainError.badRequest('MATERIAL_DUPLICATE', 'Each material can appear once');
      const found = await tx.material.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw DomainError.badRequest('MATERIAL_UNKNOWN', 'Unknown material');
      const rows = dto.lines.filter((l) => l.qty > 0);
      await tx.materialOpening.deleteMany({ where: { periodId: first.id } });
      if (rows.length) {
        await tx.materialOpening.createMany({ data: rows.map((l) => ({ periodId: first.id, materialId: l.materialId, qty: l.qty.toFixed(3), priceVnd: BigInt(l.priceVnd) })) });
      }
      // The 152 opening is the value of the materials on hand
      const value = rows.reduce((s, l) => s + valueOf(l.qty, BigInt(l.priceVnd)), 0n);
      await tx.periodOpening.deleteMany({ where: { periodId: first.id, accountCode: '152' } });
      if (value !== 0n) await tx.periodOpening.create({ data: { periodId: first.id, accountCode: '152', balanceVnd: value } });
      await this.books.invalidateSteps(tx, first, actor.id, 'Sửa tồn kho đầu kỳ');
      await this.books.log(tx, first.id, 'STOCK_OPENINGS_SAVED', actor.id, { materials: rows.length, value: String(value) });
    });
  }

  // ───────────── Catalogs ─────────────

  async saveSupplier(id: string | null, dto: SaveSupplierDto): Promise<string> {
    const data = { name: dto.name.trim(), phone: dto.phone?.trim() || null, taxCode: dto.taxCode?.trim() || null, address: dto.address?.trim() || null, isActive: dto.isActive ?? true };
    return this.prisma.$transaction(async (tx) => {
      const clash = await tx.supplier.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
      if (clash) throw DomainError.conflict('SUPPLIER_NAME_TAKEN', `Supplier "${data.name}" already exists`);
      if (id) {
        if (!(await tx.supplier.findUnique({ where: { id } }))) throw DomainError.notFound('Supplier', id);
        await tx.supplier.update({ where: { id }, data });
        return id;
      }
      const code = await this.numbering.next(tx, 'NCC');
      return (await tx.supplier.create({ data: { ...data, code } })).id;
    });
  }

  async saveMaterial(id: string | null, dto: SaveMaterialDto): Promise<string> {
    const data = { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), unit: dto.unit.trim(), isActive: dto.isActive ?? true };
    const clash = await this.prisma.material.findFirst({ where: { code: data.code, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw DomainError.conflict('MATERIAL_CODE_TAKEN', `Material code ${data.code} is taken`);
    if (id) {
      if (!(await this.prisma.material.findUnique({ where: { id } }))) throw DomainError.notFound('Material', id);
      await this.prisma.material.update({ where: { id }, data });
      return id;
    }
    return (await this.prisma.material.create({ data })).id;
  }

  async saveCategory(id: string | null, dto: SaveCategoryDto): Promise<string> {
    const split = dto.split.filter((p) => p.percent > 0).map((p) => ({ account: p.account, percent: p.percent }));
    const total = split.reduce((s, p) => s + p.percent, 0);
    if (Math.abs(total - 100) > 0.001) throw DomainError.badRequest('SPLIT_NOT_100', 'Percents must add up to 100');
    if (split.some((p) => !(COST_ACCOUNTS as readonly string[]).includes(p.account))) throw DomainError.badRequest('SPLIT_ACCOUNT', 'Split accounts must be 154, 6421 or 6422');
    if (new Set(split.map((p) => p.account)).size !== split.length) throw DomainError.badRequest('SPLIT_ACCOUNT', 'Each account can appear once');
    const name = dto.name.trim();
    const clash = await this.prisma.expenseCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw DomainError.conflict('CATEGORY_NAME_TAKEN', `Category "${name}" already exists`);
    const data = { name, split: split as unknown as Prisma.InputJsonValue, isActive: dto.isActive ?? true };
    if (id) {
      if (!(await this.prisma.expenseCategory.findUnique({ where: { id } }))) throw DomainError.notFound('ExpenseCategory', id);
      await this.prisma.expenseCategory.update({ where: { id }, data });
      return id;
    }
    const sortOrder = (await this.prisma.expenseCategory.count()) + 1;
    return (await this.prisma.expenseCategory.create({ data: { ...data, sortOrder } })).id;
  }

  // ───────────── Stock ─────────────

  async createReceipt(dto: CreateReceiptDto, actor: AuthUser): Promise<string> {
    return this.write(async (tx) => {
      const period = await this.books.openPeriodFor(tx, dto.date);
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw DomainError.notFound('Supplier', dto.supplierId);
      await this.assertMaterials(tx, dto.lines.map((l) => l.materialId));
      const value = dto.lines.reduce((s, l) => s + valueOf(l.qty, BigInt(l.priceVnd)), 0n);
      if (value <= 0n) throw DomainError.badRequest('RECEIPT_EMPTY', 'The receipt has no value');
      const vat = vatOf(value, dto.vatRate);
      const code = await this.numbering.next(tx, 'PN', new Date(`${period.month}-15T05:00:00Z`));
      const receipt = await tx.stockReceipt.create({
        data: {
          code,
          periodId: period.id,
          date: parseDateOnly(dto.date),
          supplierId: supplier.id,
          payMethod: dto.payMethod,
          vatRate: dto.vatRate,
          note: dto.note?.trim() || null,
          createdById: actor.id,
          lines: { create: dto.lines.map((l, i) => ({ materialId: l.materialId, qty: l.qty.toFixed(3), priceVnd: BigInt(l.priceVnd), sortOrder: i })) },
        },
      });
      await this.books.post(tx, {
        code,
        period,
        date: dto.date,
        description: `Nhập kho · ${supplier.name}`,
        kind: EntryKind.PURCHASE,
        sourceType: SOURCE.receipt,
        sourceId: receipt.id,
        supplierId: supplier.id,
        lines: [{ account: '152', debit: value }, { account: '1331', debit: vat }, { account: payAccount(dto.payMethod), credit: value + vat }],
        userId: actor.id,
      });
      return receipt.id;
    });
  }

  async createIssue(dto: CreateIssueDto, actor: AuthUser): Promise<string> {
    return this.write(async (tx) => {
      const period = await this.books.openPeriodFor(tx, dto.date);
      const order = dto.orderId ? await tx.order.findUnique({ where: { id: dto.orderId }, select: { id: true, code: true, customerId: true } }) : null;
      if (dto.orderId && !order) throw DomainError.notFound('Order', dto.orderId);
      await this.assertMaterials(tx, dto.lines.map((l) => l.materialId));
      // Provisional price (average known so far) and enough on hand
      const stock = await this.figures.stock(tx, period);
      const byId = new Map(stock.map((s) => [s.materialId, s]));
      const wanted = new Map<string, number>();
      for (const l of dto.lines) wanted.set(l.materialId, (wanted.get(l.materialId) ?? 0) + l.qty);
      for (const [materialId, q] of wanted) {
        const s = byId.get(materialId);
        const onHand = s ? s.endQty : 0;
        if (q > onHand + 0.0005) throw DomainError.conflict('STOCK_SHORT', `Not enough ${s?.name ?? 'material'} in stock (${onHand} ${s?.unit ?? ''})`, { materialId, onHand });
      }
      const price = (id: string) => byId.get(id)?.price ?? 0n;
      const value = dto.lines.reduce((s, l) => s + valueOf(l.qty, price(l.materialId)), 0n);
      const code = await this.numbering.next(tx, 'PX', new Date(`${period.month}-15T05:00:00Z`));
      const issue = await tx.stockIssue.create({
        data: {
          code,
          periodId: period.id,
          date: parseDateOnly(dto.date),
          orderId: order?.id ?? null,
          note: dto.note?.trim() || null,
          createdById: actor.id,
          lines: { create: dto.lines.map((l, i) => ({ materialId: l.materialId, qty: l.qty.toFixed(3), priceVnd: price(l.materialId), sortOrder: i })) },
        },
      });
      if (value > 0n) {
        await this.books.post(tx, {
          code,
          period,
          date: dto.date,
          description: order ? `Xuất kho sản xuất · ${order.code}` : 'Xuất kho dùng chung',
          kind: EntryKind.ISSUE,
          sourceType: SOURCE.issue,
          sourceId: issue.id,
          orderId: order?.id ?? null,
          customerId: order?.customerId ?? null,
          lines: [{ account: '154', debit: value }, { account: '152', credit: value }],
          userId: actor.id,
        });
      } else {
        await this.books.invalidateSteps(tx, period, actor.id, `${code}: xuất kho`);
      }
      return issue.id;
    });
  }

  private async assertMaterials(tx: Tx, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const found = await tx.material.count({ where: { id: { in: unique }, isActive: true } });
    if (found !== unique.length) throw DomainError.badRequest('MATERIAL_UNKNOWN', 'Unknown or inactive material');
  }

  // ───────────── Cash payments ─────────────

  async createCashPayment(dto: CreateCashPaymentDto, actor: AuthUser): Promise<string> {
    return this.write(async (tx) => {
      if (!dto.categoryId === !dto.supplierId) throw DomainError.badRequest('PAYMENT_TARGET', 'Choose an expense category or a supplier');
      const period = await this.books.openPeriodFor(tx, dto.date);
      const amount = BigInt(dto.amountVnd);
      const method = dto.method === 'BANK' ? PayMethod.BANK : PayMethod.CASH;
      const cash = payAccount(method);
      let lines: PostLine[];
      let vat = 0n;
      let kind: EntryKind;
      let supplierName: string | null = null;
      if (dto.categoryId) {
        const cat = await tx.expenseCategory.findUnique({ where: { id: dto.categoryId } });
        if (!cat || !cat.isActive) throw DomainError.notFound('ExpenseCategory', dto.categoryId);
        vat = vatOf(amount, dto.vatRate);
        const parts = splitAmount(amount, cat.split as unknown as Array<{ account: string; percent: number }>);
        lines = [...parts.map((p) => ({ account: p.account, debit: p.amount })), { account: '1331', debit: vat }, { account: cash, credit: amount + vat }];
        kind = EntryKind.EXPENSE;
      } else {
        const sup = await tx.supplier.findUnique({ where: { id: dto.supplierId! } });
        if (!sup) throw DomainError.notFound('Supplier', dto.supplierId!);
        supplierName = sup.name;
        lines = [{ account: '331', debit: amount }, { account: cash, credit: amount }];
        kind = EntryKind.SUPPLIER_PAYMENT;
      }
      const code = await this.numbering.next(tx, 'PC', new Date(`${period.month}-15T05:00:00Z`));
      const pc = await tx.cashPayment.create({
        data: {
          code,
          periodId: period.id,
          date: parseDateOnly(dto.date),
          description: dto.description.trim(),
          categoryId: dto.categoryId ?? null,
          supplierId: dto.supplierId ?? null,
          amountVnd: amount,
          vatRate: dto.categoryId ? dto.vatRate : 0,
          vatVnd: vat,
          method,
          createdById: actor.id,
        },
      });
      await this.books.post(tx, {
        code,
        period,
        date: dto.date,
        description: supplierName ? `Trả ${supplierName}: ${dto.description.trim()}` : dto.description.trim(),
        kind,
        sourceType: SOURCE.cash,
        sourceId: pc.id,
        supplierId: dto.supplierId ?? null,
        lines,
        userId: actor.id,
      });
      return pc.id;
    });
  }

  // ───────────── Assets ─────────────

  async createAsset(dto: CreateAssetDto, actor: AuthUser): Promise<string> {
    return this.write(async (tx) => {
      const fixed = dto.kind === AssetKind.FIXED_ASSET;
      const prefix = fixed ? 'TS' : 'CC';
      const codes = await tx.fixedAsset.findMany({ where: { kind: dto.kind }, select: { code: true } });
      const last = codes.reduce((m, c) => Math.max(m, Number(c.code.split('-')[1]) || 0), 0);
      const code = `${prefix}-${String(last + 1).padStart(2, '0')}`;
      const cost = BigInt(dto.costVnd);
      let period: AccountingPeriod | null = null;
      if (dto.purchase) {
        period = await this.books.openPeriodFor(tx, dto.purchase.date);
        if (dto.purchase.method === PayMethod.CREDIT && !dto.purchase.supplierId) throw DomainError.badRequest('ASSET_SUPPLIER_REQUIRED', 'Choose the supplier for a purchase on credit');
        if (dto.purchase.supplierId && !(await tx.supplier.findUnique({ where: { id: dto.purchase.supplierId } }))) throw DomainError.notFound('Supplier', dto.purchase.supplierId);
      } else if (!(await tx.accountingPeriod.count())) {
        throw DomainError.conflict('BOOKS_NOT_STARTED', 'Set up the first accounting period first');
      }
      const asset = await tx.fixedAsset.create({
        data: { code, kind: dto.kind, name: dto.name.trim(), costVnd: cost, startMonth: dto.startMonth, months: dto.months, expenseAccount: dto.expenseAccount, supplierId: dto.purchase?.supplierId ?? null, createdById: actor.id },
      });
      if (dto.purchase && period) {
        const vat = vatOf(cost, dto.purchase.vatRate);
        await this.books.post(tx, {
          prefix: 'PKT',
          period,
          date: dto.purchase.date,
          description: `Mua ${fixed ? 'TSCĐ' : 'CCDC'} ${code} · ${asset.name}`,
          kind: EntryKind.ASSET_PURCHASE,
          sourceType: SOURCE.asset,
          sourceId: asset.id,
          supplierId: dto.purchase.supplierId ?? null,
          lines: [{ account: fixed ? '211' : '242', debit: cost }, { account: '1331', debit: vat }, { account: payAccount(dto.purchase.method), credit: cost + vat }],
          userId: actor.id,
        });
      }
      // A new asset can change this month's depreciation / allocation
      const current = await tx.accountingPeriod.findFirst({ where: { status: PeriodStatus.OPEN, month: { gte: dto.startMonth } }, orderBy: { month: 'asc' } });
      if (current) await this.books.invalidateSteps(tx, current, actor.id, `Thêm ${code}`);
      return asset.id;
    });
  }

  // ───────────── Journal entries ─────────────

  private toLines(lines: EntryLineInputDto[]): PostLine[] {
    return lines.map((l) => ({ account: l.account.trim(), debit: BigInt(l.debitVnd), credit: BigInt(l.creditVnd) }));
  }

  async createManualEntry(dto: CreateManualEntryDto, actor: AuthUser): Promise<string> {
    return this.write(async (tx) => {
      const period = await this.books.openPeriodFor(tx, dto.date);
      return this.books.post(tx, { prefix: 'PKT', period, date: dto.date, description: dto.description.trim(), kind: EntryKind.MANUAL, source: EntrySource.MANUAL, lines: this.toLines(dto.lines), userId: actor.id });
    });
  }

  async updateEntry(id: string, dto: UpdateEntryDto, actor: AuthUser): Promise<void> {
    await this.write(async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id }, include: { period: true, lines: { orderBy: { sortOrder: 'asc' } } } });
      if (!entry) throw DomainError.notFound('JournalEntry', id);
      this.books.assertOpen(entry.period);
      if (STEP_KINDS.includes(entry.kind)) throw DomainError.conflict('ENTRY_LOCKED', 'Month-end entries are recalculated, not edited');
      const manual = entry.source === EntrySource.MANUAL;
      if (!manual && !dto.reason?.trim()) throw DomainError.badRequest('EDIT_REASON_REQUIRED', 'Say why an automatic entry is changed');
      const lines = this.toLines(dto.lines)
        .map((l) => ({ accountCode: l.account, debitVnd: l.debit ?? 0n, creditVnd: l.credit ?? 0n }))
        .filter((l) => l.debitVnd !== 0n || l.creditVnd !== 0n);
      if (lines.some((l) => l.debitVnd > 0n && l.creditVnd > 0n)) throw DomainError.badRequest('ENTRY_BOTH_SIDES', 'A line is either debit or credit');
      if (!isBalanced(lines)) throw DomainError.badRequest('ENTRY_UNBALANCED', 'Total debit must equal total credit and be above 0');
      await this.books.assertAccounts(tx, lines.map((l) => l.accountCode));
      await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
      await tx.journalLine.createMany({ data: lines.map((l, i) => ({ ...l, entryId: entry.id, sortOrder: i })) });
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: manual
          ? { description: dto.description?.trim() || entry.description }
          : {
              originalLines: (entry.originalLines ?? entry.lines.map((l) => ({ account: l.accountCode, debitVnd: String(l.debitVnd), creditVnd: String(l.creditVnd) }))) as Prisma.InputJsonValue,
              editReason: dto.reason!.trim(),
              editedById: actor.id,
              editedAt: new Date(),
            },
      });
      await this.books.invalidateSteps(tx, entry.period, actor.id, `Sửa ${entry.code}`);
      await this.books.log(tx, entry.periodId, 'ENTRY_EDITED', actor.id, { code: entry.code, reason: dto.reason?.trim() ?? null }, entry.code);
    });
  }

  /** Delete a manual entry, or an accountant's voucher with its entry. CRM postings follow the CRM and can't be deleted. */
  async deleteEntry(id: string, actor: AuthUser): Promise<void> {
    await this.write(async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id }, include: { period: true } });
      if (!entry) throw DomainError.notFound('JournalEntry', id);
      this.books.assertOpen(entry.period);
      if (STEP_KINDS.includes(entry.kind) || (entry.sourceType && CRM_SOURCES.includes(entry.sourceType))) {
        throw DomainError.conflict('ENTRY_LOCKED', 'This entry follows the CRM or the month-end steps and cannot be deleted');
      }
      await this.deleteSource(tx, entry.sourceType, entry.sourceId);
      await tx.journalEntry.delete({ where: { id: entry.id } });
      await this.books.invalidateSteps(tx, entry.period, actor.id, `Xoá ${entry.code}`);
      await this.books.log(tx, entry.periodId, 'ENTRY_DELETED', actor.id, { code: entry.code, description: entry.description }, entry.code);
    });
  }

  private async deleteSource(tx: Tx, sourceType: string | null, sourceId: string | null): Promise<void> {
    if (!sourceType || !sourceId) return;
    if (sourceType === SOURCE.receipt) {
      const r = await tx.stockReceipt.findUnique({ where: { id: sourceId }, include: { lines: true, period: true } });
      if (!r) return;
      // Removing material already issued would leave negative stock
      const stock = await this.figures.stock(tx, r.period);
      for (const l of r.lines) {
        const s = stock.find((x) => x.materialId === l.materialId);
        if (s && s.endQty - qtyOf(l.qty) < -0.0005) throw DomainError.conflict('STOCK_SHORT', `${s.name} from this receipt was already issued`, { materialId: l.materialId });
      }
      await tx.stockReceipt.delete({ where: { id: sourceId } });
    } else if (sourceType === SOURCE.issue) {
      await tx.stockIssue.deleteMany({ where: { id: sourceId } });
    } else if (sourceType === SOURCE.cash) {
      await tx.cashPayment.deleteMany({ where: { id: sourceId } });
    } else if (sourceType === SOURCE.asset) {
      await tx.fixedAsset.deleteMany({ where: { id: sourceId } });
    }
  }

  /** Delete a stock receipt with its entry */
  async deleteReceipt(id: string, actor: AuthUser): Promise<void> {
    const entry = await this.prisma.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: SOURCE.receipt, sourceId: id } }, select: { id: true } });
    if (!entry) throw DomainError.notFound('StockReceipt', id);
    await this.deleteEntry(entry.id, actor);
  }

  /** Delete an issue whose value was 0 (no entry), or any voucher by its id */
  async deleteIssue(id: string, actor: AuthUser): Promise<void> {
    await this.write(async (tx) => {
      const issue = await tx.stockIssue.findUnique({ where: { id }, include: { period: true } });
      if (!issue) throw DomainError.notFound('StockIssue', id);
      this.books.assertOpen(issue.period);
      await tx.journalEntry.deleteMany({ where: { sourceType: SOURCE.issue, sourceId: id } });
      await tx.stockIssue.delete({ where: { id } });
      await this.books.invalidateSteps(tx, issue.period, actor.id, `Xoá ${issue.code}`);
      await this.books.log(tx, issue.periodId, 'ENTRY_DELETED', actor.id, { code: issue.code }, issue.code);
    });
  }

  /** An asset owned before the books (no purchase entry) can be removed while no closed month charged it */
  async deleteAsset(id: string, actor: AuthUser): Promise<void> {
    await this.write(async (tx) => {
      const asset = await tx.fixedAsset.findUnique({ where: { id } });
      if (!asset) throw DomainError.notFound('FixedAsset', id);
      const entry = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: SOURCE.asset, sourceId: id } }, include: { period: true } });
      if (entry) this.books.assertOpen(entry.period);
      const charged = await tx.accountingPeriod.count({ where: { status: PeriodStatus.CLOSED, month: { gte: asset.startMonth } } });
      if (charged) throw DomainError.conflict('ASSET_CHARGED', 'A closed month already charged this asset');
      if (entry) await tx.journalEntry.delete({ where: { id: entry.id } });
      await tx.fixedAsset.delete({ where: { id } });
      const current = await tx.accountingPeriod.findFirst({ where: { status: PeriodStatus.OPEN }, orderBy: { month: 'asc' } });
      if (current) await this.books.invalidateSteps(tx, current, actor.id, `Xoá ${asset.code}`);
    });
  }
}
