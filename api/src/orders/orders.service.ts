import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { DeliveryStatus, OrderStatus, PricingMode } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import { can, type AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import { pageArgs } from '../common/dto/pagination.dto';
import { DomainError } from '../common/errors/domain-error';
import { addDays, parseDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField, optionalBigInt } from '../common/utils/input';
import { toSearchText } from '../common/utils/vn-text';
import { NumberingService } from '../numbering/numbering.service';
import { AREA_UNIT, orderLineDescription, piecePrice } from '../quotes/line-pricing';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { OrderRecalcService } from './order-recalc.service';
import { OPEN_STATUSES, orderCardInclude, orderDetailInclude, toOrderCard, toOrderDetail } from './order-views';
import type {
  BoardDto,
  BoardQueryDto,
  CancelOrderDto,
  CreateOrderDto,
  OrderDetailDto,
  OrderLineInputDto,
  OrderListDto,
  OrderQueryDto,
  ReplaceLinesDto,
  UpdateOrderDto,
} from './orders.dto';

const BOARD_COLUMNS: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.DESIGNING,
  OrderStatus.DESIGN_FINALIZING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.DELIVERING,
  OrderStatus.COMPLETED,
];
const BOARD_COMPLETED_DAYS = 14;

@Injectable()
export class OrdersService {
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

  // ───────────── Reads ─────────────

  async get(id: string, actor: AuthUser): Promise<OrderDetailDto> {
    const o = await this.prisma.order.findUnique({ where: { id }, include: orderDetailInclude });
    if (!o) throw DomainError.notFound('Order', id);
    return this.forActor(toOrderDetail(o, this.today()), actor);
  }

  async getByCode(code: string, actor: AuthUser): Promise<OrderDetailDto> {
    const o = await this.prisma.order.findUnique({ where: { code: code.toUpperCase() }, include: orderDetailInclude });
    if (!o) throw DomainError.notFound('Order');
    return this.forActor(toOrderDetail(o, this.today()), actor);
  }

  /** Payments are only listed for accounts allowed to see them. Amounts are removed by MoneyInterceptor. */
  private forActor(order: OrderDetailDto, actor: AuthUser): OrderDetailDto {
    return can(actor, 'payments.view') ? order : { ...order, payments: [] };
  }

  async list(query: OrderQueryDto): Promise<OrderListDto> {
    const where = this.listWhere(query.q, {
      status: query.status,
      customerId: query.customerId,
      dueBefore: query.dueBefore,
      overdue: query.overdue,
      hasUnplanned: query.hasUnplanned,
    });
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderCardInclude,
        orderBy: [{ orderDate: 'desc' }, { code: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.order.count({ where }),
    ]);
    const today = this.today();
    return { items: rows.map((r) => toOrderCard(r, today)), total };
  }

  async board(query: BoardQueryDto): Promise<Omit<BoardDto, 'quotes'>> {
    const today = this.today();
    const completedSince = parseDateOnly(addDays(today, -BOARD_COMPLETED_DAYS));
    const where: Prisma.OrderWhereInput = {
      AND: [
        this.listWhere(query.q, {
          dueBefore: query.due === 'week' ? addDays(today, 7) : undefined,
          overdue: query.due === 'overdue',
          hasUnplanned: query.hasUnplanned,
        }),
        {
          OR: [
            { status: { in: OPEN_STATUSES } },
            { status: OrderStatus.COMPLETED, completedAt: { gte: completedSince } },
          ],
        },
      ],
    };
    const rows = await this.prisma.order.findMany({
      where,
      include: orderCardInclude,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
    });
    const cards = rows.map((r) => toOrderCard(r, today));
    return {
      completedDays: BOARD_COMPLETED_DAYS,
      columns: BOARD_COLUMNS.map((status) => {
        const orders = cards.filter((c) => c.status === status);
        if (status === OrderStatus.COMPLETED) orders.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
        return { status, count: orders.length, orders };
      }),
    };
  }

  private listWhere(
    q: string | undefined,
    f: { status?: OrderStatus; customerId?: string; dueBefore?: string; overdue?: boolean; hasUnplanned?: boolean },
  ): Prisma.OrderWhereInput {
    const and: Prisma.OrderWhereInput[] = [];
    if (f.status) and.push({ status: f.status });
    if (f.customerId) and.push({ customerId: f.customerId });
    if (f.dueBefore) and.push({ dueDate: { lte: dateField(f.dueBefore, 'dueBefore') } });
    if (f.overdue) {
      and.push({
        status: { in: OPEN_STATUSES },
        dueDate: { lt: parseDateOnly(this.today()) },
      });
    }
    if (f.hasUnplanned) {
      and.push({
        status: { not: OrderStatus.CANCELLED },
        lines: { some: { plannedQty: { lt: this.prisma.orderLine.fields.quantity } } },
      });
    }
    if (q?.trim()) {
      const text = toSearchText(q);
      const digits = q.replace(/\D/g, '');
      and.push({
        OR: [
          { code: { contains: q.trim().toUpperCase() } },
          { customer: { searchText: { contains: text } } },
          ...(digits.length >= 3 ? [{ customer: { phone: { contains: digits } } }] : []),
          { lines: { some: { description: { contains: q.trim(), mode: 'insensitive' as const } } } },
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  // ───────────── Writes ─────────────

  async create(dto: CreateOrderDto, actor: AuthUser): Promise<OrderDetailDto> {
    if (dto.deposit && !can(actor, 'payments.create')) {
      throw DomainError.forbidden('PERMISSION_DENIED', 'Recording a deposit needs permission payments.create');
    }
    if (dto.lines.some((l) => l.unitPriceVnd !== undefined && l.unitPriceVnd !== null) && !can(actor, 'money.view')) {
      throw DomainError.forbidden('PERMISSION_DENIED', 'Entering prices needs permission money.view');
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw DomainError.notFound('Customer', dto.customerId);

    const orderDate = dto.orderDate ? dateField(dto.orderDate, 'orderDate') : parseDateOnly(this.today());
    const dueDate = dto.dueDate ? dateField(dto.dueDate, 'dueDate') : null;
    const trips = (dto.deliveries ?? []).map((t, i) => {
      const lines = new Map<number, number>();
      for (const l of t.lines) {
        if (l.lineIndex >= dto.lines.length) {
          throw DomainError.badRequest('INVALID_LINE_INDEX', `Trip ${i + 1} refers to line ${l.lineIndex + 1}, which does not exist`);
        }
        lines.set(l.lineIndex, (lines.get(l.lineIndex) ?? 0) + l.plannedQty);
      }
      return { plannedDate: dateField(t.plannedDate, `deliveries[${i}].plannedDate`), address: cleanText(t.address), note: cleanText(t.note), lines };
    });

    const id = await this.prisma.$transaction(async (tx) => {
      const code = await this.numbering.next(tx, 'DH');
      const order = await tx.order.create({
        data: {
          code,
          customerId: customer.id,
          orderDate,
          dueDate,
          note: cleanText(dto.note),
          createdById: actor.id,
          lines: { create: (await this.resolveLines(tx, dto.lines, new Map(), true)).map((l, i) => ({ ...l, sortOrder: i })) },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.activity.log(tx, { orderId: order.id, entityType: 'ORDER', entityId: order.id, action: 'ORDER_CREATED', toValue: code, userId: actor.id });

      for (const trip of trips) {
        const deliveryCode = await this.numbering.next(tx, 'GH');
        const delivery = await tx.delivery.create({
          data: {
            code: deliveryCode,
            orderId: order.id,
            plannedDate: trip.plannedDate,
            address: trip.address ?? customer.address,
            note: trip.note,
            createdById: actor.id,
            lines: { create: [...trip.lines].map(([index, qty]) => ({ orderLineId: order.lines[index].id, plannedQty: qty })) },
          },
        });
        await this.activity.log(tx, {
          orderId: order.id,
          entityType: 'DELIVERY',
          entityId: delivery.id,
          action: 'DELIVERY_PLANNED',
          toValue: deliveryCode,
          data: { plannedDate: trip.plannedDate.toISOString().slice(0, 10) },
          userId: actor.id,
        });
      }

      if (dto.deposit) {
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            amountVnd: BigInt(dto.deposit.amountVnd),
            method: dto.deposit.method,
            paidOn: dto.deposit.paidOn ? dateField(dto.deposit.paidOn, 'deposit.paidOn') : orderDate,
            isDeposit: true,
            note: cleanText(dto.deposit.note),
            recordedById: actor.id,
          },
        });
        await this.activity.log(tx, {
          orderId: order.id,
          entityType: 'PAYMENT',
          entityId: payment.id,
          action: 'PAYMENT_RECORDED',
          toValue: String(dto.deposit.amountVnd),
          data: { isDeposit: true, method: dto.deposit.method },
          userId: actor.id,
        });
      }

      await this.recalc.recalc(tx, order.id, actor.id);
      return order.id;
    });
    return this.get(id, actor);
  }

  async update(id: string, dto: UpdateOrderDto, actor: AuthUser): Promise<OrderDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOpen(tx, id);
      await tx.order.update({
        where: { id: order.id },
        data: {
          orderDate: dto.orderDate ? dateField(dto.orderDate, 'orderDate') : undefined,
          dueDate: dto.dueDate === undefined ? undefined : dto.dueDate === null ? null : dateField(dto.dueDate, 'dueDate'),
          note: dto.note === undefined ? undefined : cleanText(dto.note),
        },
      });
      await this.activity.log(tx, { orderId: id, entityType: 'ORDER', entityId: id, action: 'ORDER_UPDATED', data: { ...dto }, userId: actor.id });
    });
    return this.get(id, actor);
  }

  /** Replace the order lines. Kept lines keep their id; removed lines must have no trips. */
  async replaceLines(id: string, dto: ReplaceLinesDto, actor: AuthUser): Promise<OrderDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOpen(tx, id);
      // Revenue is booked at acceptance from these lines: after that they are final
      if (order.status === OrderStatus.COMPLETED || order.acceptedAt) {
        throw DomainError.conflict('ORDER_COMPLETED', `${order.code} was accepted by the customer; its lines can no longer change`);
      }
      const current = await tx.orderLine.findMany({ where: { orderId: id }, include: { _count: { select: { deliveryLines: true } } } });
      const currentIds = new Set(current.map((l) => l.id));
      const keepIds = new Set(dto.lines.filter((l) => l.id).map((l) => l.id!));

      for (const lineId of keepIds) {
        if (!currentIds.has(lineId)) throw DomainError.badRequest('LINE_NOT_IN_ORDER', `Line ${lineId} does not belong to this order`);
      }
      for (const line of current) {
        if (keepIds.has(line.id)) continue;
        if (line._count.deliveryLines > 0) {
          throw DomainError.conflict('LINE_HAS_DELIVERIES', `"${line.description}" is on a delivery trip and cannot be removed. Remove it from the trips first.`, {
            orderLineId: line.id,
          });
        }
        await tx.orderLine.delete({ where: { id: line.id } });
      }

      // Accounts that can't see prices never receive them, so they can't send them back: keep the stored price.
      const seesPrices = can(actor, 'money.view');
      const stored = new Map(current.map((l) => [l.id, l]));
      const resolved = await this.resolveLines(tx, dto.lines, stored, seesPrices, dto.lines.map((l) => l.id));
      const changes: string[] = [];
      for (const line of current) if (!keepIds.has(line.id)) changes.push(`Bỏ "${line.description}"`);
      for (const [i, l] of dto.lines.entries()) {
        const data = { ...resolved[i], sortOrder: i };
        if (l.id) {
          const before = stored.get(l.id)!;
          if (before.description !== data.description) changes.push(`Đổi "${before.description}" → "${data.description}"`);
          if (before.quantity !== data.quantity) changes.push(`"${data.description}": số lượng ${before.quantity} → ${data.quantity}`);
          if (before.unitPriceVnd !== data.unitPriceVnd) changes.push(`"${data.description}": đổi đơn giá`);
          await tx.orderLine.update({ where: { id: l.id }, data });
        } else {
          changes.push(`Thêm "${data.description}" × ${data.quantity}`);
          await tx.orderLine.create({ data: { ...data, orderId: id } });
        }
      }

      if (changes.length) await this.activity.log(tx, { orderId: id, entityType: 'ORDER', entityId: id, action: 'LINES_CHANGED', data: { count: dto.lines.length, changes }, userId: actor.id });
      await this.recalc.recalc(tx, id, actor.id);
    });
    return this.get(id, actor);
  }

  async cancel(id: string, dto: CancelOrderDto, actor: AuthUser): Promise<OrderDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOpen(tx, id);
      if (order.status === OrderStatus.COMPLETED) {
        throw DomainError.conflict('ORDER_COMPLETED', 'A completed order cannot be cancelled');
      }
      const scheduled = await tx.delivery.findMany({ where: { orderId: id, status: DeliveryStatus.SCHEDULED } });
      for (const d of scheduled) {
        await tx.delivery.update({ where: { id: d.id }, data: { status: DeliveryStatus.CANCELLED, cancelReason: `Order cancelled: ${dto.reason}` } });
        await this.activity.log(tx, { orderId: id, entityType: 'DELIVERY', entityId: d.id, action: 'DELIVERY_CANCELLED', toValue: d.code, userId: actor.id });
      }
      await tx.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED, cancelReason: dto.reason.trim(), cancelledAt: new Date() },
      });
      await this.activity.log(tx, {
        orderId: id,
        entityType: 'ORDER',
        entityId: id,
        action: 'STATUS_CHANGED',
        fromValue: order.status,
        toValue: OrderStatus.CANCELLED,
        data: { reason: dto.reason.trim() },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, id, actor.id);
    });
    return this.get(id, actor);
  }

  /**
   * Turn line input into stored columns. Catalog products priced per m² get their piece price from the size,
   * so changing the size or swapping the product re-prices the line on the server.
   */
  private async resolveLines(
    tx: Tx,
    lines: OrderLineInputDto[],
    stored: Map<string, { productId: string | null; unitPriceVnd: bigint | null; areaPriceVnd: bigint | null; unit: string | null }>,
    seesPrices: boolean,
    ids: Array<string | undefined> = [],
  ) {
    const productIds = [...new Set(lines.map((l) => l.productId).filter((v): v is string => !!v))];
    const products = new Map((await tx.product.findMany({ where: { id: { in: productIds } } })).map((p) => [p.id, p]));
    return lines.map((l, i) => {
      const product = l.productId ? products.get(l.productId) : undefined;
      if (l.productId && !product) throw DomainError.badRequest('PRODUCT_NOT_FOUND', `Line ${i + 1}: product not found`, { index: i });
      const before = ids[i] ? stored.get(ids[i]!) : undefined;
      const sized = l.widthM != null && l.heightM != null;
      const areaLine = sized && (product ? product.pricingMode === PricingMode.AREA : (before?.areaPriceVnd ?? null) !== null || l.areaPriceVnd != null);
      if (areaLine) {
        // An explicit price per m² wins; a swapped product brings its list price; otherwise keep the stored price.
        const productChanged = !!product && before?.productId !== product.id;
        const areaPriceVnd =
          (seesPrices && l.areaPriceVnd != null ? BigInt(l.areaPriceVnd) : null) ??
          (productChanged || before?.areaPriceVnd == null ? (product?.unitPriceVnd ?? null) : null) ??
          before!.areaPriceVnd!;
        const w = Math.round(l.widthM! * 100);
        const h = Math.round(l.heightM! * 100);
        return {
          productId: product?.id ?? null,
          description: orderLineDescription({ description: l.description.trim(), widthM: w / 100, heightM: h / 100 }),
          spec: cleanText(l.spec),
          unit: AREA_UNIT,
          widthM: w / 100,
          heightM: h / 100,
          areaPriceVnd,
          quantity: l.quantity,
          unitPriceVnd: piecePrice(BigInt(w), BigInt(h), areaPriceVnd),
        };
      }
      const unitPriceVnd = seesPrices
        ? (optionalBigInt(l.unitPriceVnd) ?? (product && l.unitPriceVnd === undefined ? product.unitPriceVnd : null))
        : (before?.unitPriceVnd ?? null);
      return {
        productId: product?.id ?? null,
        description: l.description.trim(),
        spec: cleanText(l.spec),
        unit: cleanText(l.unit) ?? product?.unit ?? before?.unit ?? null,
        widthM: null,
        heightM: null,
        areaPriceVnd: null,
        quantity: l.quantity,
        unitPriceVnd,
      };
    });
  }

  private async loadOpen(tx: Tx, id: string) {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw DomainError.notFound('Order', id);
    if (order.status === OrderStatus.CANCELLED) throw DomainError.conflict('ORDER_CANCELLED', `${order.code} is cancelled`);
    return order;
  }
}
