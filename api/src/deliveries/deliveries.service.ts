import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { DeliveryStatus, OrderStatus } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import { can, type AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import { pageArgs } from '../common/dto/pagination.dto';
import { DomainError } from '../common/errors/domain-error';
import { parseDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { toSearchText } from '../common/utils/vn-text';
import { NumberingService } from '../numbering/numbering.service';
import { OrderRecalcService } from '../orders/order-recalc.service';
import { deliveryInclude, toDeliveryDto, toDeliveryListItem } from '../orders/order-views';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type {
  CancelDeliveryDto,
  CreateDeliveryDto,
  DeliverDto,
  DeliveryListItemDto,
  DeliveryListDto,
  DeliveryQueryDto,
  PlanLineDto,
  UpdateDeliveryDto,
} from './deliveries.dto';

const listInclude = {
  ...deliveryInclude,
  order: { select: { code: true, status: true, customer: { select: { name: true, phone: true } } } },
} satisfies Prisma.DeliveryInclude;

@Injectable()
export class DeliveriesService {
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

  async list(query: DeliveryQueryDto): Promise<DeliveryListDto> {
    const and: Prisma.DeliveryWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.from) and.push({ plannedDate: { gte: dateField(query.from, 'from') } });
    if (query.to) and.push({ plannedDate: { lte: dateField(query.to, 'to') } });
    if (query.overdue) and.push({ status: DeliveryStatus.SCHEDULED, plannedDate: { lt: parseDateOnly(this.today()) } });
    if (query.q?.trim()) {
      const q = query.q.trim();
      const digits = q.replace(/\D/g, '');
      and.push({
        OR: [
          { code: { contains: q.toUpperCase() } },
          { order: { code: { contains: q.toUpperCase() } } },
          { order: { customer: { searchText: { contains: toSearchText(q) } } } },
          ...(digits.length >= 3 ? [{ order: { customer: { phone: { contains: digits } } } }] : []),
        ],
      });
    }
    const where: Prisma.DeliveryWhereInput = and.length ? { AND: and } : {};
    const delivered = query.status === DeliveryStatus.DELIVERED;
    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: listInclude,
        orderBy: delivered ? [{ deliveredAt: 'desc' }] : [{ plannedDate: 'asc' }, { code: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.delivery.count({ where }),
    ]);
    const today = this.today();
    return { items: rows.map((r) => toDeliveryListItem(r, today)), total };
  }

  async get(id: string): Promise<DeliveryListItemDto> {
    const d = await this.prisma.delivery.findUnique({ where: { id }, include: listInclude });
    if (!d) throw DomainError.notFound('Delivery', id);
    return toDeliveryListItem(d, this.today());
  }

  // ───────────── Writes ─────────────

  /** Add a trip to an existing order. */
  async create(orderId: string, dto: CreateDeliveryDto, actor: AuthUser): Promise<DeliveryListItemDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { customer: true, lines: true } });
      if (!order) throw DomainError.notFound('Order', orderId);
      assertOrderOpen(order);
      const lines = mergePlanLines(dto.lines, new Set(order.lines.map((l) => l.id)));
      const code = await this.numbering.next(tx, 'GH');
      const d = await tx.delivery.create({
        data: {
          code,
          orderId,
          plannedDate: dateField(dto.plannedDate, 'plannedDate'),
          address: cleanText(dto.address) ?? order.customer.address,
          note: cleanText(dto.note),
          createdById: actor.id,
          lines: { create: lines.map((l) => ({ orderLineId: l.orderLineId, plannedQty: l.plannedQty })) },
        },
      });
      await this.activity.log(tx, {
        orderId,
        entityType: 'DELIVERY',
        entityId: d.id,
        action: 'DELIVERY_PLANNED',
        toValue: code,
        data: { plannedDate: dto.plannedDate },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, orderId, actor.id);
      return d.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateDeliveryDto, actor: AuthUser): Promise<DeliveryListItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const d = await this.loadScheduled(tx, id);
      const data: Prisma.DeliveryUpdateInput = {
        plannedDate: dto.plannedDate ? dateField(dto.plannedDate, 'plannedDate') : undefined,
        address: dto.address === undefined ? undefined : cleanText(dto.address),
        note: dto.note === undefined ? undefined : cleanText(dto.note),
      };
      await tx.delivery.update({ where: { id }, data });
      if (dto.lines) {
        const lineIds = new Set((await tx.orderLine.findMany({ where: { orderId: d.orderId }, select: { id: true } })).map((l) => l.id));
        const lines = mergePlanLines(dto.lines, lineIds);
        await tx.deliveryLine.deleteMany({ where: { deliveryId: id } });
        await tx.deliveryLine.createMany({ data: lines.map((l) => ({ deliveryId: id, orderLineId: l.orderLineId, plannedQty: l.plannedQty })) });
      }
      await this.activity.log(tx, {
        orderId: d.orderId,
        entityType: 'DELIVERY',
        entityId: id,
        action: 'DELIVERY_UPDATED',
        toValue: d.code,
        data: { ...(dto.plannedDate ? { plannedDate: dto.plannedDate } : {}), linesChanged: Boolean(dto.lines) },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, d.orderId, actor.id);
    });
    return this.get(id);
  }

  /**
   * Mark a trip as delivered. Each line defaults to its planned quantity and may be lowered;
   * the shortfall returns to "not yet planned". Optionally records money collected on the trip.
   */
  async deliver(id: string, dto: DeliverDto, actor: AuthUser): Promise<DeliveryListItemDto> {
    if (dto.payment && !can(actor, 'payments.create')) {
      throw DomainError.forbidden('PERMISSION_DENIED', 'Recording money collected needs permission payments.create');
    }
    await this.prisma.$transaction(async (tx) => {
      const d = await this.loadScheduled(tx, id);
      const planned = await tx.deliveryLine.findMany({ where: { deliveryId: id }, include: { orderLine: { select: { description: true } } } });
      const given = new Map<string, number>();
      for (const l of dto.lines ?? []) {
        if (given.has(l.orderLineId)) throw DomainError.badRequest('DUPLICATE_LINE', `Line ${l.orderLineId} appears twice`);
        given.set(l.orderLineId, l.deliveredQty);
      }
      for (const lineId of given.keys()) {
        if (!planned.some((p) => p.orderLineId === lineId)) {
          throw DomainError.badRequest('LINE_NOT_ON_TRIP', `Line ${lineId} is not on trip ${d.code}`);
        }
      }

      let deliveredTotal = 0;
      const shortfalls: Array<{ description: string; short: number }> = [];
      for (const p of planned) {
        const qty = given.get(p.orderLineId) ?? p.plannedQty;
        if (qty > p.plannedQty) {
          throw DomainError.badRequest(
            'DELIVERED_EXCEEDS_PLANNED',
            `${p.orderLine.description}: delivered ${qty}, planned ${p.plannedQty}. Edit the trip first to deliver more.`,
            { orderLineId: p.orderLineId, delivered: qty, planned: p.plannedQty },
          );
        }
        deliveredTotal += qty;
        if (qty < p.plannedQty) shortfalls.push({ description: p.orderLine.description, short: p.plannedQty - qty });
        await tx.deliveryLine.update({ where: { id: p.id }, data: { deliveredQty: qty } });
      }
      if (deliveredTotal === 0) {
        throw DomainError.badRequest('NOTHING_DELIVERED', 'Nothing was delivered on this trip. Cancel it or change its date instead.');
      }

      const deliveredAt = dto.deliveredAt ? new Date(dto.deliveredAt) : new Date();
      await tx.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.DELIVERED, deliveredAt, receiverName: cleanText(dto.receiverName) },
      });
      await this.activity.log(tx, {
        orderId: d.orderId,
        entityType: 'DELIVERY',
        entityId: id,
        action: 'DELIVERY_DELIVERED',
        toValue: d.code,
        data: { shortfalls, receiverName: cleanText(dto.receiverName) },
        userId: actor.id,
      });

      if (dto.payment) {
        const payment = await tx.payment.create({
          data: {
            orderId: d.orderId,
            deliveryId: id,
            amountVnd: BigInt(dto.payment.amountVnd),
            method: dto.payment.method,
            paidOn: parseDateOnly(todayInZone(this.env.APP_TIMEZONE, deliveredAt)),
            note: cleanText(dto.payment.note),
            recordedById: actor.id,
          },
        });
        await this.activity.log(tx, {
          orderId: d.orderId,
          entityType: 'PAYMENT',
          entityId: payment.id,
          action: 'PAYMENT_RECORDED',
          toValue: String(dto.payment.amountVnd),
          data: { deliveryCode: d.code, method: dto.payment.method },
          userId: actor.id,
        });
      }
      await this.recalc.recalc(tx, d.orderId, actor.id);
    });
    return this.get(id);
  }

  /** Owner only: undo "delivered" to fix a mistake. Linked payments stay. */
  async reopen(id: string, dto: CancelDeliveryDto, actor: AuthUser): Promise<DeliveryListItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const d = await tx.delivery.findUnique({ where: { id }, include: { order: true } });
      if (!d) throw DomainError.notFound('Delivery', id);
      assertOrderOpen(d.order);
      if (d.status !== DeliveryStatus.DELIVERED) throw DomainError.conflict('INVALID_STATUS', `${d.code} is not delivered`);
      await tx.deliveryLine.updateMany({ where: { deliveryId: id }, data: { deliveredQty: null } });
      await tx.delivery.update({ where: { id }, data: { status: DeliveryStatus.SCHEDULED, deliveredAt: null } });
      await this.activity.log(tx, {
        orderId: d.orderId,
        entityType: 'DELIVERY',
        entityId: id,
        action: 'DELIVERY_REOPENED',
        toValue: d.code,
        data: { reason: dto.reason.trim() },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, d.orderId, actor.id);
    });
    return this.get(id);
  }

  async cancel(id: string, dto: CancelDeliveryDto, actor: AuthUser): Promise<DeliveryListItemDto> {
    await this.prisma.$transaction(async (tx) => {
      const d = await this.loadScheduled(tx, id);
      const linked = await tx.payment.count({ where: { deliveryId: id, voidedAt: null } });
      if (linked > 0) throw DomainError.conflict('DELIVERY_HAS_PAYMENTS', `${d.code} has payments linked to it. Void them first.`);
      await tx.delivery.update({ where: { id }, data: { status: DeliveryStatus.CANCELLED, cancelReason: dto.reason.trim() } });
      await this.activity.log(tx, {
        orderId: d.orderId,
        entityType: 'DELIVERY',
        entityId: id,
        action: 'DELIVERY_CANCELLED',
        toValue: d.code,
        data: { reason: dto.reason.trim() },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, d.orderId, actor.id);
    });
    return this.get(id);
  }

  private async loadScheduled(tx: Tx, id: string) {
    const d = await tx.delivery.findUnique({ where: { id }, include: { order: true } });
    if (!d) throw DomainError.notFound('Delivery', id);
    assertOrderOpen(d.order);
    if (d.status !== DeliveryStatus.SCHEDULED) {
      throw DomainError.conflict('INVALID_STATUS', `${d.code} is ${d.status}; only scheduled trips can be changed`);
    }
    return d;
  }
}

function assertOrderOpen(order: { code: string; status: OrderStatus }): void {
  if (order.status === OrderStatus.CANCELLED) throw DomainError.conflict('ORDER_CANCELLED', `${order.code} is cancelled`);
}

/** Combine repeated lines and check they belong to the order. */
function mergePlanLines(lines: PlanLineDto[], orderLineIds: Set<string>): PlanLineDto[] {
  const merged = new Map<string, number>();
  for (const l of lines) {
    if (!orderLineIds.has(l.orderLineId)) {
      throw DomainError.badRequest('LINE_NOT_IN_ORDER', `Line ${l.orderLineId} does not belong to this order`);
    }
    merged.set(l.orderLineId, (merged.get(l.orderLineId) ?? 0) + l.plannedQty);
  }
  return [...merged].map(([orderLineId, plannedQty]) => ({ orderLineId, plannedQty }));
}

