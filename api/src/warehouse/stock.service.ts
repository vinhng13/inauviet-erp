import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { ENV, type Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import type { WhSlipKind } from '../generated/prisma/enums';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type {
  SlipDto,
  SlipInputDto,
  SlipLineInputDto,
  SlipQueryDto,
  StockAsOfDto,
  StockAsOfQueryDto,
  StockCardDto,
  StockItemDto,
  StockReportDto,
  StockReportQueryDto,
  StockUpdateDto,
  TransferInputDto,
} from './warehouse.dto';
import { WarehousesService } from './warehouses.service';
import { canConfirmIn, itemLabel, n, nn, partnerIdOrCreate } from './wh-common';

const slipInclude = {
  warehouse: { include: { members: true } },
  partner: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  confirmedBy: { select: { fullName: true } },
  lines: { include: { spec: { include: { material: true } } } },
} satisfies Prisma.WhSlipInclude;
type SlipRow = Prisma.WhSlipGetPayload<{ include: typeof slipInclude }>;

const PREFIX = { RECEIPT: 'NK', ISSUE: 'XK', RETURN: 'NL', ADJUST: 'DC', TRANSFER_OUT: 'CK', TRANSFER_IN: 'CK' } as const;
/** +1 adds to stock, -1 takes away (ADJUST lines carry their own sign) */
const SIGN: Record<WhSlipKind, 1 | -1> = { RECEIPT: 1, ISSUE: -1, RETURN: 1, ADJUST: 1, TRANSFER_OUT: -1, TRANSFER_IN: 1 };
/** Signed quantity of a slip line in SQL (confirmed, not void) */
const SIGNED = Prisma.sql`CASE WHEN s."kind" IN ('ISSUE', 'TRANSFER_OUT') THEN -l."qty" ELSE l."qty" END`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type ResolvedLine = { specId: string; qty: number; unitName: string | null; unitQty: number | null; factor: number | null; unitPriceVnd: bigint | null };

/**
 * Tồn theo kho và quy cách, phiếu nhập / xuất / nhập lại / chuyển kho / điều chỉnh, thẻ kho, kiểm kê, báo cáo.
 * Phiếu lập xong ở trạng thái chờ xác nhận; tồn chỉ đổi khi thủ kho của kho xác nhận. Tồn không bao giờ âm.
 * Không tạo bút toán, không phụ thuộc kỳ kế toán.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly warehouses: WarehousesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  today(): string {
    return todayInZone(this.env.APP_TIMEZONE);
  }

  // ───────────── Tồn ─────────────

  /** Average receipt price per base unit, per spec (confirmed receipts that carry a price) */
  private async avgPrices(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; avg: number }>>`
      SELECT l."specId" AS id,
             (SUM(l."qty" * l."unitPriceVnd" / COALESCE(l."factor", 1)) / NULLIF(SUM(l."qty"), 0))::float8 AS avg
      FROM "WhSlipLine" l JOIN "WhSlip" s ON s."id" = l."slipId"
      WHERE s."kind" = 'RECEIPT' AND s."status" = 'CONFIRMED' AND s."voidedAt" IS NULL AND l."unitPriceVnd" IS NOT NULL
      GROUP BY l."specId"`;
    return new Map(rows.map((r) => [r.id, r.avg]));
  }

  async items(warehouseId?: string, includeInactive = false): Promise<StockItemDto[]> {
    const [rows, prices, pending] = await Promise.all([
      this.prisma.whStock.findMany({
        where: {
          ...(warehouseId ? { warehouseId } : {}),
          ...(includeInactive ? {} : { isActive: true, spec: { isActive: true, material: { isActive: true } } }),
        },
        include: { warehouse: true, spec: { include: { material: { include: { units: true } } } } },
        orderBy: [
          { warehouse: { sortOrder: 'asc' } },
          { spec: { material: { group: 'asc' } } },
          { spec: { material: { name: 'asc' } } },
          { spec: { widthCm: 'asc' } },
          { spec: { lengthCm: 'asc' } },
        ],
      }),
      this.avgPrices(),
      this.prisma.$queryRaw<Array<{ warehouseId: string; specId: string; qty: number }>>`
        SELECT s."warehouseId", l."specId", SUM(l."qty")::float8 AS qty
        FROM "WhSlipLine" l JOIN "WhSlip" s ON s."id" = l."slipId"
        WHERE s."status" = 'PENDING' AND s."kind" IN ('ISSUE', 'TRANSFER_OUT')
        GROUP BY s."warehouseId", l."specId"`,
    ]);
    return rows.map((st) => this.itemDto(st, prices, pending));
  }

  private itemDto(
    st: Prisma.WhStockGetPayload<{ include: { warehouse: true; spec: { include: { material: { include: { units: true } } } } } }>,
    prices: Map<string, number>,
    pending: Array<{ warehouseId: string; specId: string; qty: number }>,
  ): StockItemDto {
    const m = st.spec.material;
    const qty = n(st.qty);
    const minQty = nn(st.minQty);
    const avg = prices.get(st.specId);
    // Spec-specific units first win over material-wide units of the same name
    const units = new Map<string, { id: string | null; name: string; factor: number }>();
    for (const u of m.units.filter((u) => u.specId === null)) units.set(u.name, { id: u.id, name: u.name, factor: n(u.factor) });
    for (const u of m.units.filter((u) => u.specId === st.specId)) units.set(u.name, { id: u.id, name: u.name, factor: n(u.factor) });
    return {
      id: st.id,
      warehouseId: st.warehouseId,
      warehouseCode: st.warehouse.code,
      specId: st.specId,
      materialId: m.id,
      materialCode: m.code,
      group: m.group,
      materialName: m.name,
      unit: m.unit,
      hasSizes: m.hasSizes,
      widthCm: n(st.spec.widthCm),
      lengthCm: n(st.spec.lengthCm),
      label: itemLabel(m, st.spec),
      qty,
      minQty,
      low: minQty !== null && qty < minQty,
      isActive: st.isActive && st.spec.isActive && m.isActive,
      pendingOut: pending.find((p) => p.warehouseId === st.warehouseId && p.specId === st.specId)?.qty ?? 0,
      valueVnd: avg === undefined ? null : Math.round(qty * avg),
      units: [{ id: null, name: m.unit, factor: 1 }, ...units.values()],
    };
  }

  async updateStock(id: string, dto: StockUpdateDto): Promise<void> {
    const res = await this.prisma.whStock.updateMany({
      where: { id },
      data: { ...(dto.minQty !== undefined ? { minQty: dto.minQty } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
    if (!res.count) throw DomainError.notFound('WhStock', id);
  }

  // ───────────── Phiếu ─────────────

  async slips(q: SlipQueryDto, actor: AuthUser): Promise<SlipDto[]> {
    const where: Prisma.WhSlipWhereInput = {};
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.month) {
      const start = dateField(`${q.month}-01`, 'month');
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      where.date = { gte: start, lt: end };
    }
    if (q.from || q.to) {
      where.date = { ...(q.from ? { gte: dateField(q.from, 'from') } : {}), ...(q.to ? { lte: dateField(q.to, 'to') } : {}) };
    }
    if (q.q?.trim()) {
      const t = q.q.trim();
      where.OR = [
        { code: { contains: t, mode: 'insensitive' } },
        { reference: { contains: t, mode: 'insensitive' } },
        { receiver: { contains: t, mode: 'insensitive' } },
        { purpose: { contains: t, mode: 'insensitive' } },
        { partner: { name: { contains: t, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.prisma.whSlip.findMany({ where, include: slipInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
    const pairs = await this.counterparts(rows);
    return rows.map((s) => this.slipDto(s, actor, pairs.get(s.id) ?? null));
  }

  async slip(id: string, actor: AuthUser): Promise<SlipDto> {
    const s = await this.prisma.whSlip.findUnique({ where: { id }, include: slipInclude });
    if (!s) throw DomainError.notFound('WhSlip', id);
    const pairs = await this.counterparts([s]);
    return this.slipDto(s, actor, pairs.get(s.id) ?? null);
  }

  private async counterparts(rows: SlipRow[]): Promise<Map<string, SlipRow>> {
    const ids = [...new Set(rows.map((r) => r.transferId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const all = await this.prisma.whSlip.findMany({ where: { transferId: { in: ids } }, include: slipInclude });
    const map = new Map<string, SlipRow>();
    for (const r of rows) {
      const other = all.find((a) => a.transferId === r.transferId && a.id !== r.id);
      if (other) map.set(r.id, other);
    }
    return map;
  }

  /** Validates lines against the warehouse and converts each to base units */
  private async resolveLines(tx: Tx, warehouseId: string, lines: SlipLineInputDto[], withPrice: boolean): Promise<ResolvedLine[]> {
    const ids = [...new Set(lines.map((l) => l.specId))];
    if (ids.length !== lines.length) throw DomainError.badRequest('WH_LINE_DUPLICATE', 'Each size may appear once per slip');
    // Vật tư là danh mục chung: kho chưa có quy cách này thì thêm dòng tồn (và kho – vật tư) ngay khi lập phiếu
    const specs = await tx.whSpec.findMany({ where: { id: { in: ids } }, include: { material: true } });
    for (const id of ids) {
      const p = specs.find((x) => x.id === id);
      if (!p || !p.isActive || !p.material.isActive) throw DomainError.badRequest('WH_ITEM_INACTIVE', 'This material or size is not in use');
      await tx.whWarehouseMaterial.upsert({ where: { warehouseId_materialId: { warehouseId, materialId: p.materialId } }, create: { warehouseId, materialId: p.materialId }, update: {} });
      await tx.whStock.upsert({ where: { warehouseId_specId: { warehouseId, specId: id } }, create: { warehouseId, specId: id }, update: { isActive: true } });
    }
    const stocks = await tx.whStock.findMany({ where: { warehouseId, specId: { in: ids } }, include: { spec: { include: { material: { include: { units: true } } } } } });
    return lines.map((l) => {
      const st = stocks.find((s) => s.specId === l.specId)!;
      let factor: number | null = null;
      let unitName: string | null = null;
      if (l.unitId) {
        const u = st.spec.material.units.find((x) => x.id === l.unitId && (x.specId === null || x.specId === l.specId));
        if (!u) throw DomainError.badRequest('WH_UNIT_UNKNOWN', 'Unknown unit for this material');
        factor = n(u.factor);
        unitName = u.name;
      }
      const qty = r3(l.qty * (factor ?? 1));
      if (qty <= 0) throw DomainError.badRequest('WH_QTY_INVALID', 'Quantity must be above zero');
      return {
        specId: l.specId,
        qty,
        unitName,
        unitQty: factor === null ? null : l.qty,
        factor,
        unitPriceVnd: withPrice && l.unitPriceVnd != null ? BigInt(l.unitPriceVnd) : null,
      };
    });
  }

  async createSlip(dto: SlipInputDto, actor: AuthUser): Promise<SlipDto> {
    if (dto.kind === 'ISSUE' && !cleanText(dto.receiver)) throw DomainError.badRequest('WH_RECEIVER_REQUIRED', 'Issue slips need the receiver');
    const id = await this.prisma.$transaction(async (tx) => {
      const w = await this.warehouses.stockWarehouse(tx, dto.warehouseId);
      const lines = await this.resolveLines(tx, w.id, dto.lines, dto.kind === 'RECEIPT');
      const partnerId = dto.kind === 'RECEIPT' ? await partnerIdOrCreate(tx, dto.partnerId, dto.partnerName, 'SUPPLIER') : null;
      const slip = await tx.whSlip.create({
        data: {
          code: await this.numbering.nextWarehouse(tx, PREFIX[dto.kind], w.code, dateField(dto.date, 'date')),
          warehouseId: w.id,
          kind: dto.kind,
          date: dateField(dto.date, 'date'),
          partnerId,
          receiver: cleanText(dto.receiver),
          purpose: cleanText(dto.purpose),
          reference: cleanText(dto.reference),
          note: cleanText(dto.note),
          createdById: actor.id,
          lines: { create: lines },
        },
      });
      if (dto.confirm && this.warehouses.canConfirm(actor, w)) await this.confirmIn(tx, slip.id, actor);
      return slip.id;
    });
    return this.slip(id, actor);
  }

  /** Phiếu chuyển kho: một phiếu đi (kho A) và một phiếu đến (kho B), chung transferId */
  async createTransfer(dto: TransferInputDto, actor: AuthUser): Promise<SlipDto> {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw DomainError.badRequest('WH_TRANSFER_SAME', 'Choose two different warehouses');
    const id = await this.prisma.$transaction(async (tx) => {
      const from = await this.warehouses.stockWarehouse(tx, dto.fromWarehouseId);
      const to = await this.warehouses.stockWarehouse(tx, dto.toWarehouseId);
      const lines = await this.resolveLines(tx, from.id, dto.lines, false);
      // Kho nhận chưa có vật tư thì thêm vào (kho – vật tư và dòng tồn)
      const specs = await tx.whSpec.findMany({ where: { id: { in: lines.map((l) => l.specId) } } });
      for (const p of specs) {
        await tx.whWarehouseMaterial.upsert({
          where: { warehouseId_materialId: { warehouseId: to.id, materialId: p.materialId } },
          create: { warehouseId: to.id, materialId: p.materialId },
          update: {},
        });
        await tx.whStock.upsert({ where: { warehouseId_specId: { warehouseId: to.id, specId: p.id } }, create: { warehouseId: to.id, specId: p.id }, update: { isActive: true } });
      }
      const transferId = randomUUID();
      const date = dateField(dto.date, 'date');
      const common = { date, transferId, receiver: cleanText(dto.receiver), reference: cleanText(dto.reference), note: cleanText(dto.note), createdById: actor.id };
      const out = await tx.whSlip.create({
        data: {
          ...common,
          code: await this.numbering.nextWarehouse(tx, 'CK', from.code, date),
          warehouseId: from.id,
          kind: 'TRANSFER_OUT',
          purpose: `Chuyển sang ${to.name}`,
          lines: { create: lines },
        },
      });
      await tx.whSlip.create({
        data: {
          ...common,
          code: await this.numbering.nextWarehouse(tx, 'CK', to.code, date),
          warehouseId: to.id,
          kind: 'TRANSFER_IN',
          purpose: `Nhận từ ${from.name}`,
          lines: { create: lines },
        },
      });
      if (dto.confirm && this.warehouses.canConfirm(actor, from)) await this.confirmIn(tx, out.id, actor);
      return out.id;
    });
    return this.slip(id, actor);
  }

  async confirmSlip(id: string, actor: AuthUser): Promise<SlipDto> {
    await this.prisma.$transaction((tx) => this.confirmIn(tx, id, actor));
    return this.slip(id, actor);
  }

  /** Thủ kho xác nhận: tồn thay đổi tại đây */
  private async confirmIn(tx: Tx, id: string, actor: AuthUser): Promise<void> {
    const s = await tx.whSlip.findUnique({ where: { id }, include: { warehouse: { include: { members: true } }, lines: { include: { spec: { include: { material: true } } } } } });
    if (!s) throw DomainError.notFound('WhSlip', id);
    if (s.status !== 'PENDING') throw DomainError.conflict('WH_SLIP_NOT_PENDING', 'This slip is no longer waiting for confirmation');
    if (!this.warehouses.canConfirm(actor, s.warehouse)) throw DomainError.forbidden('WH_NOT_KEEPER', 'Only the storekeeper of this warehouse can confirm');
    if (s.kind === 'TRANSFER_IN') {
      const out = await tx.whSlip.findFirst({ where: { transferId: s.transferId, kind: 'TRANSFER_OUT' } });
      if (out?.status !== 'CONFIRMED') throw DomainError.conflict('WH_TRANSFER_NOT_SENT', 'The sending warehouse has not confirmed this transfer yet');
    }
    // Chiếm quyền xác nhận trước khi đổi tồn: hai người bấm cùng lúc chỉ một người được
    const claimed = await tx.whSlip.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: actor.id } });
    if (!claimed.count) throw DomainError.conflict('WH_SLIP_NOT_PENDING', 'This slip is no longer waiting for confirmation');
    for (const l of s.lines) await this.applyQty(tx, s.warehouseId, l.specId, SIGN[s.kind] * n(l.qty), l.spec);
  }

  async rejectSlip(id: string, reason: string, actor: AuthUser): Promise<SlipDto> {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.whSlip.findUnique({ where: { id }, include: { warehouse: { include: { members: true } } } });
      if (!s) throw DomainError.notFound('WhSlip', id);
      if (s.status !== 'PENDING') throw DomainError.conflict('WH_SLIP_NOT_PENDING', 'This slip is no longer waiting for confirmation');
      if (!this.warehouses.canConfirm(actor, s.warehouse)) throw DomainError.forbidden('WH_NOT_KEEPER', 'Only the storekeeper of this warehouse can reject');
      const ids = await this.transferIdsForClose(tx, s);
      await tx.whSlip.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: reason.trim(), confirmedAt: new Date(), confirmedById: actor.id } });
    });
    return this.slip(id, actor);
  }

  async cancelSlip(id: string, actor: AuthUser): Promise<SlipDto> {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.whSlip.findUnique({ where: { id }, include: { warehouse: { include: { members: true } } } });
      if (!s) throw DomainError.notFound('WhSlip', id);
      if (s.status !== 'PENDING') throw DomainError.conflict('WH_SLIP_NOT_PENDING', 'Only slips waiting for confirmation can be cancelled');
      if (s.createdById !== actor.id && !this.warehouses.canConfirm(actor, s.warehouse)) {
        throw DomainError.forbidden('WH_NOT_OWNER', 'Only the person who made the slip, or the storekeeper, can cancel it');
      }
      const ids = await this.transferIdsForClose(tx, s);
      await tx.whSlip.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    });
    return this.slip(id, actor);
  }

  /** Closing one side of a transfer closes both, as long as nothing has left the sending warehouse */
  private async transferIdsForClose(tx: Tx, s: { id: string; transferId: string | null }): Promise<string[]> {
    if (!s.transferId) return [s.id];
    const pair = await tx.whSlip.findMany({ where: { transferId: s.transferId } });
    if (pair.some((p) => p.kind === 'TRANSFER_OUT' && p.status === 'CONFIRMED')) {
      throw DomainError.conflict('WH_TRANSFER_SENT', 'The goods have left the sending warehouse; the sending storekeeper can void the transfer instead');
    }
    return pair.map((p) => p.id);
  }

  /** Changes on-hand quantity atomically; refuses to go below zero */
  private async applyQty(tx: Tx, warehouseId: string, specId: string, delta: number, spec: { material: { name: string; hasSizes: boolean }; widthCm: Prisma.Decimal; lengthCm: Prisma.Decimal }): Promise<void> {
    const where = { warehouseId_specId: { warehouseId, specId } };
    if (delta >= 0) {
      await tx.whStock.upsert({ where, create: { warehouseId, specId, qty: delta }, update: { qty: { increment: delta } } });
      return;
    }
    const res = await tx.whStock.updateMany({ where: { warehouseId, specId, qty: { gte: -delta } }, data: { qty: { decrement: -delta } } });
    if (res.count === 0) {
      const cur = await tx.whStock.findUnique({ where });
      throw DomainError.badRequest('WH_STOCK_SHORT', `Not enough stock for ${itemLabel(spec.material, spec)}`, {
        item: itemLabel(spec.material, spec),
        onHand: n(cur?.qty),
        requested: -delta,
      });
    }
  }

  /** Huỷ phiếu đã xác nhận: trả lại tồn. Phiếu chuyển kho huỷ cả hai phía. */
  async voidSlip(id: string, reason: string, actor: AuthUser): Promise<SlipDto> {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.whSlip.findUnique({ where: { id }, include: { warehouse: { include: { members: true } } } });
      if (!s) throw DomainError.notFound('WhSlip', id);
      if (s.voidedAt) throw DomainError.conflict('WH_SLIP_VOIDED', 'This slip is already void');
      if (s.status !== 'CONFIRMED') throw DomainError.conflict('WH_SLIP_NOT_CONFIRMED', 'Only confirmed slips can be voided; cancel or reject the others');
      if (!this.warehouses.canConfirm(actor, s.warehouse)) throw DomainError.forbidden('WH_NOT_KEEPER', 'Only the storekeeper of this warehouse can void');
      const all = s.transferId ? await tx.whSlip.findMany({ where: { transferId: s.transferId } }) : [s];
      // Phía nhận trước (lấy hàng ra khỏi kho nhận), rồi trả về kho đi
      all.sort((a) => (a.kind === 'TRANSFER_IN' ? -1 : 1));
      for (const x of all) {
        if (x.status === 'PENDING') {
          await tx.whSlip.update({ where: { id: x.id }, data: { status: 'CANCELLED' } });
          continue;
        }
        if (x.status !== 'CONFIRMED' || x.voidedAt) continue;
        const lines = await tx.whSlipLine.findMany({ where: { slipId: x.id }, include: { spec: { include: { material: true } } } });
        for (const l of lines) {
          try {
            await this.applyQty(tx, x.warehouseId, l.specId, -SIGN[x.kind] * n(l.qty), l.spec);
          } catch (e) {
            if (e instanceof DomainError && e.code === 'WH_STOCK_SHORT') throw DomainError.badRequest('WH_VOID_NEGATIVE', 'Voiding this slip would make stock negative', e.details);
            throw e;
          }
        }
        await tx.whSlip.update({ where: { id: x.id }, data: { voidedAt: new Date(), voidReason: reason.trim(), voidedById: actor.id } });
      }
    });
    return this.slip(id, actor);
  }

  async card(stockId: string): Promise<StockCardDto> {
    const st = await this.prisma.whStock.findUnique({ where: { id: stockId } });
    if (!st) throw DomainError.notFound('WhStock', stockId);
    const item = (await this.items(st.warehouseId, true)).find((i) => i.id === stockId)!;
    const lines = await this.prisma.whSlipLine.findMany({
      where: { specId: st.specId, slip: { warehouseId: st.warehouseId, status: 'CONFIRMED', voidedAt: null } },
      include: { slip: { include: { partner: { select: { name: true } } } } },
      orderBy: [{ slip: { date: 'asc' } }, { slip: { confirmedAt: 'asc' } }],
    });
    let balance = 0;
    const rows = lines.map((l) => {
      const signed = SIGN[l.slip.kind] * n(l.qty);
      balance += signed;
      return {
        date: formatDateOnly(l.slip.date)!,
        slipId: l.slipId,
        code: l.slip.code,
        kind: l.slip.kind,
        partyText: l.slip.partner?.name ?? l.slip.receiver ?? l.slip.purpose,
        reference: l.slip.reference,
        inQty: signed > 0 ? signed : 0,
        outQty: signed < 0 ? -signed : 0,
        balance: r3(balance),
      };
    });
    return { item, rows: rows.reverse() };
  }

  private slipDto(s: SlipRow, actor: AuthUser, other: SlipRow | null): SlipDto {
    const canConfirm = s.status === 'PENDING' && canConfirmIn(actor, s.warehouse.members.map((m) => m.userId))
      && !(s.kind === 'TRANSFER_IN' && other?.status !== 'CONFIRMED');
    return {
      id: s.id,
      code: s.code,
      warehouseId: s.warehouseId,
      warehouseCode: s.warehouse.code,
      warehouseName: s.warehouse.name,
      kind: s.kind,
      status: s.status,
      date: formatDateOnly(s.date)!,
      partnerId: s.partnerId,
      partnerName: s.partner?.name ?? null,
      receiver: s.receiver,
      purpose: s.purpose,
      reference: s.reference,
      note: s.note,
      createdById: s.createdById,
      createdBy: s.createdBy.fullName,
      createdAt: s.createdAt,
      confirmedAt: s.confirmedAt,
      confirmedBy: s.confirmedBy?.fullName ?? null,
      rejectReason: s.rejectReason,
      voidedAt: s.voidedAt,
      voidReason: s.voidReason,
      counterpart: other
        ? { id: other.id, code: other.code, warehouseId: other.warehouseId, warehouseCode: other.warehouse.code, warehouseName: other.warehouse.name, status: other.status }
        : null,
      canConfirm,
      canCancel: s.status === 'PENDING' && (s.createdById === actor.id || canConfirmIn(actor, s.warehouse.members.map((m) => m.userId)))
        && !(s.transferId && (s.kind === 'TRANSFER_IN' ? other?.status === 'CONFIRMED' : false)),
      lines: s.lines.map((l) => ({
        id: l.id,
        specId: l.specId,
        label: itemLabel(l.spec.material, l.spec),
        unit: l.spec.material.unit,
        qty: n(l.qty),
        unitName: l.unitName,
        unitQty: nn(l.unitQty),
        unitPriceVnd: l.unitPriceVnd === null ? null : Number(l.unitPriceVnd),
      })),
    };
  }

  // ───────────── Báo cáo ─────────────

  /** Nhập – xuất – tồn: tồn đầu (trước from), nhập, xuất trong khoảng, tồn cuối */
  async report(q: StockReportQueryDto): Promise<StockReportDto> {
    if (q.from > q.to) throw DomainError.badRequest('WH_RANGE_INVALID', '"From" is after "to"');
    const from = dateField(q.from, 'from');
    const to = dateField(q.to, 'to');
    const [items, sums] = await Promise.all([
      this.items(q.warehouseId, true),
      this.prisma.$queryRaw<Array<{ specId: string; opening: number; inQty: number; outQty: number }>>`
        SELECT l."specId",
          COALESCE(SUM(CASE WHEN s."date" < ${from} THEN ${SIGNED} END), 0)::float8 AS opening,
          COALESCE(SUM(CASE WHEN s."date" BETWEEN ${from} AND ${to} AND ${SIGNED} > 0 THEN ${SIGNED} END), 0)::float8 AS "inQty",
          COALESCE(SUM(CASE WHEN s."date" BETWEEN ${from} AND ${to} AND ${SIGNED} < 0 THEN -(${SIGNED}) END), 0)::float8 AS "outQty"
        FROM "WhSlipLine" l JOIN "WhSlip" s ON s."id" = l."slipId"
        WHERE s."warehouseId" = ${q.warehouseId}::uuid AND s."status" = 'CONFIRMED' AND s."voidedAt" IS NULL AND s."date" <= ${to}
        GROUP BY l."specId"`,
    ]);
    const rows = items
      .map((i) => {
        const x = sums.find((r) => r.specId === i.specId);
        const opening = r3(x?.opening ?? 0);
        const inQty = r3(x?.inQty ?? 0);
        const outQty = r3(x?.outQty ?? 0);
        return { stockId: i.id, specId: i.specId, group: i.group, label: i.label, unit: i.unit, opening, inQty, outQty, closing: r3(opening + inQty - outQty), active: i.isActive };
      })
      .filter((r) => r.active || r.opening || r.inQty || r.outQty)
      .map(({ active: _a, ...r }) => r);
    return { warehouseId: q.warehouseId, from: q.from, to: q.to, rows };
  }

  /** Tồn cuối ngày theo phiếu đã xác nhận (đơn vị cơ sở), theo quy cách */
  async ledgerAsOf(tx: Tx | PrismaService, warehouseId: string, date: string): Promise<Map<string, number>> {
    const d = dateField(date, 'date');
    const rows = await tx.$queryRaw<Array<{ specId: string; qty: number }>>`
      SELECT l."specId", COALESCE(SUM(${SIGNED}), 0)::float8 AS qty
      FROM "WhSlipLine" l JOIN "WhSlip" s ON s."id" = l."slipId"
      WHERE s."warehouseId" = ${warehouseId}::uuid AND s."status" = 'CONFIRMED' AND s."voidedAt" IS NULL AND s."date" <= ${d}
      GROUP BY l."specId"`;
    return new Map(rows.map((r) => [r.specId, r3(r.qty)]));
  }

  async asOf(q: StockAsOfQueryDto): Promise<StockAsOfDto> {
    const d = dateField(q.date, 'date');
    const [items, live, snap] = await Promise.all([
      this.items(q.warehouseId, true),
      this.ledgerAsOf(this.prisma, q.warehouseId, q.date),
      this.prisma.whDailyStock.findMany({ where: { warehouseId: q.warehouseId, date: d } }),
    ]);
    const source = snap.length ? 'SNAPSHOT' : 'LIVE';
    const rows = items
      .map((i) => {
        const liveQty = live.get(i.specId) ?? 0;
        const s = snap.find((x) => x.specId === i.specId);
        return { stockId: i.id, specId: i.specId, group: i.group, label: i.label, unit: i.unit, qty: source === 'SNAPSHOT' ? (s ? n(s.qty) : 0) : liveQty, liveQty, active: i.isActive };
      })
      .filter((r) => r.active || r.qty || r.liveQty)
      .map(({ active: _a, ...r }) => r);
    const takenAt = snap.length ? snap.reduce((t, x) => (x.takenAt > t ? x.takenAt : t), snap[0].takenAt) : null;
    return { warehouseId: q.warehouseId, date: q.date, source, takenAt, rows };
  }

  // ───────────── Kiểm kê vật tư ─────────────
}
