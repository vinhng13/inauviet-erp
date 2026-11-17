import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { ENV, type Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type {
  CountCreateDto,
  CountDto,
  CountUpdateDto,
  SlipDto,
  SlipInputDto,
  SlipQueryDto,
  StockCardDto,
  StockItemDto,
} from './warehouse.dto';
import { assertMonthOpen, itemLabel, n, nn } from './wh-common';

const slipInclude = {
  partner: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  lines: { include: { stockItem: { include: { material: true } } } },
} satisfies Prisma.WhSlipInclude;
type SlipRow = Prisma.WhSlipGetPayload<{ include: typeof slipInclude }>;

const PREFIX = { RECEIPT: 'NK', ISSUE: 'XK', RETURN: 'NL', ADJUST: 'DC' } as const;
/** +1 adds to stock, -1 takes away (ADJUST lines carry their own sign) */
const SIGN = { RECEIPT: 1, ISSUE: -1, RETURN: 1, ADJUST: 1 } as const;

/**
 * Giấy và vật tư: phiếu nhập / xuất / nhập lại / điều chỉnh, tồn tức thời, thẻ kho, kiểm kê.
 * Tồn = đầu kỳ + nhập − xuất + nhập lại ± điều chỉnh; số tồn cache trên mã tồn được đổi cùng giao dịch với phiếu
 * và không bao giờ âm. Không tạo bút toán, không phụ thuộc kỳ kế toán.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Average receipt price per stock item (receipts that carry a price) */
  private async avgPrices(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; avg: number }>>`
      SELECT l."stockItemId" AS id, (SUM(l."qty" * l."unitPriceVnd") / NULLIF(SUM(l."qty"), 0))::float8 AS avg
      FROM "WhSlipLine" l JOIN "WhSlip" s ON s."id" = l."slipId"
      WHERE s."kind" = 'RECEIPT' AND s."voidedAt" IS NULL AND l."unitPriceVnd" IS NOT NULL
      GROUP BY l."stockItemId"`;
    return new Map(rows.map((r) => [r.id, r.avg]));
  }

  async items(includeInactive = false): Promise<StockItemDto[]> {
    const [rows, prices] = await Promise.all([
      this.prisma.whStockItem.findMany({
        where: includeInactive ? {} : { isActive: true, material: { isActive: true } },
        include: { material: true },
        orderBy: [{ material: { group: 'asc' } }, { material: { name: 'asc' } }, { widthCm: 'asc' }, { lengthCm: 'asc' }],
      }),
      this.avgPrices(),
    ]);
    return rows.map((i) => {
      const qty = n(i.qty);
      const minQty = nn(i.minQty);
      const avg = prices.get(i.id);
      return {
        id: i.id,
        materialId: i.materialId,
        group: i.material.group,
        materialName: i.material.name,
        unit: i.material.unit,
        hasSizes: i.material.hasSizes,
        widthCm: n(i.widthCm),
        lengthCm: n(i.lengthCm),
        label: itemLabel(i.material, i),
        qty,
        minQty,
        low: minQty !== null && qty < minQty,
        isActive: i.isActive && i.material.isActive,
        valueVnd: avg === undefined ? null : Math.round(qty * avg),
      };
    });
  }

  // ───────────── Phiếu ─────────────

  async slips(q: SlipQueryDto): Promise<SlipDto[]> {
    const where: Prisma.WhSlipWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.month) {
      const start = dateField(`${q.month}-01`, 'month');
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      where.date = { gte: start, lt: end };
    }
    if (q.q?.trim()) {
      const t = q.q.trim();
      where.OR = [
        { code: { contains: t, mode: 'insensitive' } },
        { reference: { contains: t, mode: 'insensitive' } },
        { receiver: { contains: t, mode: 'insensitive' } },
        { partner: { name: { contains: t, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.prisma.whSlip.findMany({ where, include: slipInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 300 });
    return rows.map((s) => this.slipDto(s));
  }

  async slip(id: string): Promise<SlipDto> {
    const s = await this.prisma.whSlip.findUnique({ where: { id }, include: slipInclude });
    if (!s) throw DomainError.notFound('WhSlip', id);
    return this.slipDto(s);
  }

  async createSlip(dto: SlipInputDto, actor: AuthUser): Promise<SlipDto> {
    if (dto.kind === 'ISSUE' && !cleanText(dto.receiver)) throw DomainError.badRequest('WH_RECEIVER_REQUIRED', 'Issue slips need the receiver');
    const id = await this.prisma.$transaction((tx) => this.writeSlip(tx, dto.kind, dto, actor));
    return this.slip(id);
  }

  /** Shared by slips and stock counts (ADJUST, signed quantities) */
  async writeSlip(
    tx: Tx,
    kind: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUST',
    dto: Pick<SlipInputDto, 'date' | 'partnerId' | 'receiver' | 'purpose' | 'reference' | 'note'> & { lines: Array<{ stockItemId: string; qty: number; unitPriceVnd?: number | null }> },
    actor: AuthUser,
    countId?: string,
  ): Promise<string> {
    await assertMonthOpen(tx, dto.date);
    const ids = [...new Set(dto.lines.map((l) => l.stockItemId))];
    if (ids.length !== dto.lines.length) throw DomainError.badRequest('WH_LINE_DUPLICATE', 'Each stock item may appear once per slip');
    const items = await tx.whStockItem.findMany({ where: { id: { in: ids } }, include: { material: true } });
    if (items.length !== ids.length) throw DomainError.badRequest('WH_ITEM_NOT_FOUND', 'Unknown stock item');
    const code = await this.numbering.next(tx, PREFIX[kind], dateField(dto.date, 'date'));
    const slip = await tx.whSlip.create({
      data: {
        code,
        kind,
        date: dateField(dto.date, 'date'),
        partnerId: kind === 'RECEIPT' ? (dto.partnerId ?? null) : null,
        receiver: cleanText(dto.receiver),
        purpose: cleanText(dto.purpose),
        reference: cleanText(dto.reference),
        note: cleanText(dto.note),
        countId: countId ?? null,
        createdById: actor.id,
        lines: {
          create: dto.lines.map((l) => ({
            stockItemId: l.stockItemId,
            qty: l.qty,
            unitPriceVnd: kind === 'RECEIPT' && l.unitPriceVnd != null ? BigInt(l.unitPriceVnd) : null,
          })),
        },
      },
    });
    for (const l of dto.lines) await this.applyQty(tx, l.stockItemId, SIGN[kind] * l.qty, items.find((i) => i.id === l.stockItemId)!);
    return slip.id;
  }

  /** Changes on-hand quantity atomically; refuses to go below zero */
  private async applyQty(tx: Tx, stockItemId: string, delta: number, item: { material: { name: string; hasSizes: boolean }; widthCm: Prisma.Decimal; lengthCm: Prisma.Decimal }): Promise<void> {
    if (delta >= 0) {
      await tx.whStockItem.update({ where: { id: stockItemId }, data: { qty: { increment: delta } } });
      return;
    }
    const res = await tx.whStockItem.updateMany({ where: { id: stockItemId, qty: { gte: -delta } }, data: { qty: { decrement: -delta } } });
    if (res.count === 0) {
      const cur = await tx.whStockItem.findUniqueOrThrow({ where: { id: stockItemId } });
      throw DomainError.badRequest('WH_STOCK_SHORT', `Not enough stock for ${itemLabel(item.material, item)}`, {
        item: itemLabel(item.material, item),
        onHand: n(cur.qty),
        requested: -delta,
      });
    }
  }

  async voidSlip(id: string, reason: string, actor: AuthUser): Promise<SlipDto> {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.whSlip.findUnique({ where: { id }, include: { lines: { include: { stockItem: { include: { material: true } } } } } });
      if (!s) throw DomainError.notFound('WhSlip', id);
      if (s.voidedAt) throw DomainError.conflict('WH_SLIP_VOIDED', 'This slip is already void');
      if (s.kind === 'ADJUST') throw DomainError.badRequest('WH_ADJUST_FIXED', 'Count adjustments cannot be voided; run a new count');
      await assertMonthOpen(tx, formatDateOnly(s.date));
      for (const l of s.lines) {
        try {
          await this.applyQty(tx, l.stockItemId, -SIGN[s.kind] * n(l.qty), l.stockItem);
        } catch (e) {
          if (e instanceof DomainError && e.code === 'WH_STOCK_SHORT') {
            throw DomainError.badRequest('WH_VOID_NEGATIVE', 'Voiding this slip would make stock negative', e.details);
          }
          throw e;
        }
      }
      await tx.whSlip.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason.trim(), voidedById: actor.id } });
    });
    return this.slip(id);
  }

  async card(stockItemId: string): Promise<StockCardDto> {
    const item = (await this.items(true)).find((i) => i.id === stockItemId);
    if (!item) throw DomainError.notFound('WhStockItem', stockItemId);
    const lines = await this.prisma.whSlipLine.findMany({
      where: { stockItemId, slip: { voidedAt: null } },
      include: { slip: { include: { partner: { select: { name: true } } } } },
      orderBy: [{ slip: { date: 'asc' } }, { slip: { createdAt: 'asc' } }],
    });
    let balance = 0;
    const rows = lines.map((l) => {
      const signed = SIGN[l.slip.kind] * n(l.qty);
      balance += signed;
      return {
        date: formatDateOnly(l.slip.date),
        slipId: l.slipId,
        code: l.slip.code,
        kind: l.slip.kind,
        partyText: l.slip.partner?.name ?? l.slip.receiver ?? l.slip.purpose,
        reference: l.slip.reference,
        inQty: signed > 0 ? signed : 0,
        outQty: signed < 0 ? -signed : 0,
        balance: Math.round(balance * 1000) / 1000,
      };
    });
    return { item, rows: rows.reverse() };
  }

  private slipDto(s: SlipRow): SlipDto {
    return {
      id: s.id,
      code: s.code,
      kind: s.kind,
      date: formatDateOnly(s.date),
      partnerId: s.partnerId,
      partnerName: s.partner?.name ?? null,
      receiver: s.receiver,
      purpose: s.purpose,
      reference: s.reference,
      note: s.note,
      createdBy: s.createdBy.fullName,
      createdAt: s.createdAt,
      voidedAt: s.voidedAt,
      voidReason: s.voidReason,
      lines: s.lines.map((l) => ({
        id: l.id,
        stockItemId: l.stockItemId,
        label: itemLabel(l.stockItem.material, l.stockItem),
        unit: l.stockItem.material.unit,
        qty: n(l.qty),
        unitPriceVnd: l.unitPriceVnd === null ? null : Number(l.unitPriceVnd),
      })),
    };
  }

  // ───────────── Kiểm kê vật tư ─────────────

  async counts(): Promise<CountDto[]> {
    const rows = await this.prisma.whCount.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true } });
    return Promise.all(rows.map((r) => this.count(r.id, false)));
  }

  async count(id: string, withLines = true): Promise<CountDto> {
    const c = await this.prisma.whCount.findUnique({
      where: { id },
      include: {
        createdBy: { select: { fullName: true } },
        slip: { select: { code: true } },
        lines: { include: { stockItem: { include: { material: true } } } },
      },
    });
    if (!c) throw DomainError.notFound('WhCount', id);
    const lines = c.lines
      .map((l) => {
        const counted = nn(l.countedQty);
        return {
          stockItemId: l.stockItemId,
          label: itemLabel(l.stockItem.material, l.stockItem),
          group: l.stockItem.material.group,
          unit: l.stockItem.material.unit,
          systemQty: n(l.systemQty),
          countedQty: counted,
          diff: counted === null ? null : Math.round((counted - n(l.systemQty)) * 1000) / 1000,
        };
      })
      .sort((a, b) => a.group.localeCompare(b.group, 'vi') || a.label.localeCompare(b.label, 'vi'));
    return {
      id: c.id,
      code: c.code,
      date: formatDateOnly(c.date),
      status: c.status,
      note: c.note,
      createdBy: c.createdBy.fullName,
      createdAt: c.createdAt,
      approvedAt: c.approvedAt,
      adjustSlipCode: c.slip?.code ?? null,
      counted: lines.filter((l) => l.countedQty !== null).length,
      total: lines.length,
      lines: withLines ? lines : [],
    };
  }

  async createCount(dto: CountCreateDto, actor: AuthUser): Promise<CountDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const open = await tx.whCount.findFirst({ where: { status: 'DRAFT' } });
      if (open) throw DomainError.conflict('WH_COUNT_OPEN', `Finish or cancel count ${open.code} first`);
      const items = await tx.whStockItem.findMany({
        where: { isActive: true, material: { isActive: true, ...(dto.groups?.length ? { group: { in: dto.groups } } : {}) } },
      });
      if (!items.length) throw DomainError.badRequest('WH_COUNT_EMPTY', 'No stock items to count');
      const c = await tx.whCount.create({
        data: {
          code: await this.numbering.next(tx, 'KKV', dateField(dto.date, 'date')),
          date: dateField(dto.date, 'date'),
          note: cleanText(dto.note),
          createdById: actor.id,
          lines: { create: items.map((i) => ({ stockItemId: i.id, systemQty: i.qty })) },
        },
      });
      return c.id;
    });
    return this.count(id);
  }

  async updateCount(id: string, dto: CountUpdateDto): Promise<CountDto> {
    const c = await this.prisma.whCount.findUnique({ where: { id } });
    if (!c) throw DomainError.notFound('WhCount', id);
    if (c.status !== 'DRAFT') throw DomainError.conflict('WH_COUNT_CLOSED', 'This count is already closed');
    await this.prisma.$transaction(
      dto.entries.map((e) => this.prisma.whCountLine.updateMany({ where: { countId: id, stockItemId: e.stockItemId }, data: { countedQty: e.countedQty } })),
    );
    return this.count(id);
  }

  /** Duyệt: tạo phiếu điều chỉnh theo chênh lệch giữa số đếm và tồn hiện tại (kể cả phiếu lập trong lúc đếm) */
  async approveCount(id: string, actor: AuthUser): Promise<CountDto> {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.whCount.findUnique({ where: { id }, include: { lines: { include: { stockItem: true } } } });
      if (!c) throw DomainError.notFound('WhCount', id);
      if (c.status !== 'DRAFT') throw DomainError.conflict('WH_COUNT_CLOSED', 'This count is already closed');
      const lines = c.lines
        .filter((l) => l.countedQty !== null)
        .map((l) => ({ stockItemId: l.stockItemId, qty: Math.round((n(l.countedQty) - n(l.stockItem.qty)) * 1000) / 1000 }))
        .filter((l) => l.qty !== 0);
      if (lines.length) {
        await this.writeSlip(tx, 'ADJUST', { date: formatDateOnly(c.date), purpose: `Điều chỉnh theo kiểm kê ${c.code}`, lines }, actor, c.id);
      }
      await tx.whCount.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    });
    return this.count(id);
  }

  async cancelCount(id: string): Promise<void> {
    const res = await this.prisma.whCount.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
    if (!res.count) throw DomainError.conflict('WH_COUNT_CLOSED', 'This count is already closed');
  }

  today(): string {
    return todayInZone(this.env.APP_TIMEZONE);
  }
}
