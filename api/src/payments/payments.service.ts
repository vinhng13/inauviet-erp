import { Inject, Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import { DomainError } from '../common/errors/domain-error';
import { parseDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { OrderRecalcService } from '../orders/order-recalc.service';
import { toPaymentDto } from '../orders/order-views';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { DeliveryStatus, OrderStatus } from '../generated/prisma/enums';
import { pageArgs } from '../common/dto/pagination.dto';
import { formatDateOnly } from '../common/utils/dates';
import { toSearchText } from '../common/utils/vn-text';
import type {
  CreatePaymentDto,
  PaymentDto,
  PaymentListDto,
  PaymentQueryDto,
  ReceivableListDto,
  ReceivableQueryDto,
  VoidPaymentDto,
} from './payments.dto';

const paymentInclude = { delivery: { select: { code: true } }, recordedBy: { select: { fullName: true } } } as const;

/** Payments are optional and never change order status. They are voided, never deleted. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly recalc: OrderRecalcService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** All receipts, newest first ("Khoản thu") */
  async list(query: PaymentQueryDto): Promise<PaymentListDto> {
    const and: Prisma.PaymentWhereInput[] = [];
    if (!query.includeVoided) and.push({ voidedAt: null });
    if (query.from) and.push({ paidOn: { gte: dateField(query.from, 'from') } });
    if (query.to) and.push({ paidOn: { lte: dateField(query.to, 'to') } });
    if (query.method) and.push({ method: query.method });
    const order = orderSearch(query.q);
    if (order) and.push({ order });
    const where: Prisma.PaymentWhereInput = and.length ? { AND: and } : {};
    const [rows, total, sum] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { ...paymentInclude, order: { select: { code: true, status: true, customer: { select: { id: true, name: true } } } } },
        orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where: { AND: [where, { voidedAt: null }] }, _sum: { amountVnd: true } }),
    ]);
    return {
      items: rows.map((p) => ({
        ...toPaymentDto(p),
        orderCode: p.order.code,
        orderStatus: p.order.status,
        customerId: p.order.customer.id,
        customerName: p.order.customer.name,
      })),
      total,
      sumVnd: Number(sum._sum.amountVnd ?? 0n),
    };
  }

  /** Orders still owing money ("Công nợ"): delivered ones first, then by order date */
  async receivables(query: ReceivableQueryDto): Promise<ReceivableListDto> {
    const search = orderSearch(query.q);
    const rows = await this.prisma.order.findMany({
      where: { AND: [{ status: { not: OrderStatus.CANCELLED } }, { totalVnd: { not: null } }, ...(search ? [search] : [])] },
      select: {
        id: true,
        code: true,
        status: true,
        orderDate: true,
        totalVnd: true,
        paidVnd: true,
        customer: { select: { id: true, name: true, phone: true } },
        deliveries: { where: { status: DeliveryStatus.DELIVERED }, select: { deliveredAt: true }, orderBy: { deliveredAt: 'asc' } },
      },
      orderBy: [{ orderDate: 'asc' }, { code: 'asc' }],
    });
    let deliveredBalance = 0n;
    let upcomingBalance = 0n;
    let depositsHeld = 0n;
    const items: ReceivableListDto['items'] = [];
    for (const o of rows) {
      const delivered = o.deliveries.length > 0;
      if (!delivered && o.status !== OrderStatus.COMPLETED) depositsHeld += o.paidVnd;
      const balance = o.totalVnd! - o.paidVnd;
      if (balance <= 0n) continue;
      if (delivered) deliveredBalance += balance;
      else upcomingBalance += balance;
      if (query.deliveredOnly && !delivered) continue;
      items.push({
        orderId: o.id,
        orderCode: o.code,
        orderStatus: o.status,
        customerId: o.customer.id,
        customerName: o.customer.name,
        customerPhone: o.customer.phone,
        orderDate: formatDateOnly(o.orderDate),
        totalVnd: Number(o.totalVnd),
        paidVnd: Number(o.paidVnd),
        balanceVnd: Number(balance),
        delivered,
        firstDeliveredAt: o.deliveries[0]?.deliveredAt?.toISOString() ?? null,
      });
    }
    items.sort((a, b) => Number(b.delivered) - Number(a.delivered));
    return { items, deliveredBalanceVnd: Number(deliveredBalance), upcomingBalanceVnd: Number(upcomingBalance), depositsHeldVnd: Number(depositsHeld) };
  }

  async listForOrder(orderId: string): Promise<PaymentDto[]> {
    const rows = await this.prisma.payment.findMany({
      where: { orderId },
      include: paymentInclude,
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toPaymentDto);
  }

  async create(orderId: string, dto: CreatePaymentDto, actor: AuthUser): Promise<PaymentDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw DomainError.notFound('Order', orderId);
      let deliveryCode: string | undefined;
      if (dto.deliveryId) {
        const d = await tx.delivery.findUnique({ where: { id: dto.deliveryId } });
        if (!d || d.orderId !== orderId) {
          throw DomainError.badRequest('DELIVERY_NOT_IN_ORDER', 'That trip does not belong to this order');
        }
        deliveryCode = d.code;
      }
      const p = await tx.payment.create({
        data: {
          orderId,
          deliveryId: dto.deliveryId ?? null,
          amountVnd: BigInt(dto.amountVnd),
          method: dto.method,
          paidOn: dto.paidOn ? dateField(dto.paidOn, 'paidOn') : parseDateOnly(todayInZone(this.env.APP_TIMEZONE)),
          isDeposit: dto.isDeposit ?? false,
          note: cleanText(dto.note),
          recordedById: actor.id,
        },
      });
      await this.activity.log(tx, {
        orderId,
        entityType: 'PAYMENT',
        entityId: p.id,
        action: 'PAYMENT_RECORDED',
        toValue: String(dto.amountVnd),
        data: { method: dto.method, isDeposit: dto.isDeposit ?? false, deliveryCode },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, orderId, actor.id);
      return p.id;
    });
    return this.get(id);
  }

  async void(id: string, dto: VoidPaymentDto, actor: AuthUser): Promise<PaymentDto> {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id } });
      if (!p) throw DomainError.notFound('Payment', id);
      if (p.voidedAt) throw DomainError.conflict('ALREADY_VOIDED', 'This payment is already voided');
      await tx.payment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.activity.log(tx, {
        orderId: p.orderId,
        entityType: 'PAYMENT',
        entityId: id,
        action: 'PAYMENT_VOIDED',
        fromValue: String(p.amountVnd),
        data: { reason: dto.reason.trim() },
        userId: actor.id,
      });
      await this.recalc.recalc(tx, p.orderId, actor.id);
    });
    return this.get(id);
  }

  private async get(id: string): Promise<PaymentDto> {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude });
    return toPaymentDto(p);
  }
}

function orderSearch(q: string | undefined): Prisma.OrderWhereInput | null {
  if (!q?.trim()) return null;
  const text = q.trim();
  const digits = text.replace(/\D/g, '');
  return {
    OR: [
      { code: { contains: text.toUpperCase() } },
      { customer: { searchText: { contains: toSearchText(text) } } },
      ...(digits.length >= 3 ? [{ customer: { phone: { contains: digits } } }] : []),
    ],
  };
}
