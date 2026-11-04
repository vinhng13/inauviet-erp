import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import { DomainError } from '../common/errors/domain-error';
import type { Tx } from '../prisma/prisma.service';
import { calculateOrder } from './order-calc';

/**
 * Runs at the end of every write that touches an order's lines, deliveries or payments.
 * Recomputes cached quantities, totals and status from the source rows (see order-calc.ts),
 * enforces "never plan more than ordered", and logs status changes.
 * Throwing here rolls back the whole transaction.
 */
@Injectable()
export class OrderRecalcService {
  constructor(private readonly activity: ActivityService) {}

  async recalc(tx: Tx, orderId: string, actorId: string | null): Promise<void> {
    // Lock the order row so concurrent edits to the same order run one after another.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        lines: true,
        deliveries: { include: { lines: true } },
        payments: { select: { amountVnd: true, voidedAt: true } },
      },
    });
    if (!order) throw DomainError.notFound('Order', orderId);

    const result = calculateOrder({
      status: order.status,
      confirmedAt: order.confirmedAt,
      needsDesign: order.needsDesign,
      designApprovedAt: order.designApprovedAt,
      productionStartedAt: order.productionStartedAt,
      productionDoneAt: order.productionDoneAt,
      acceptedAt: order.acceptedAt,
      lines: order.lines.map((l) => ({ id: l.id, quantity: l.quantity, unitPriceVnd: l.unitPriceVnd })),
      deliveries: order.deliveries.map((d) => ({
        status: d.status,
        lines: d.lines.map((dl) => ({ orderLineId: dl.orderLineId, plannedQty: dl.plannedQty, deliveredQty: dl.deliveredQty })),
      })),
      payments: order.payments,
    });

    if (result.overPlanned.length > 0) {
      const byId = new Map(order.lines.map((l) => [l.id, l.description]));
      const lines = result.overPlanned.map((o) => ({ ...o, description: byId.get(o.orderLineId) }));
      const text = lines.map((l) => `${l.description}: planned ${l.planned}, ordered ${l.ordered}`).join('; ');
      throw DomainError.conflict('PLANNED_QTY_EXCEEDS_ORDER', text, { lines });
    }

    for (const line of order.lines) {
      const q = result.lines.get(line.id)!;
      if (q.plannedQty !== line.plannedQty || q.deliveredQty !== line.deliveredQty || q.lineTotalVnd !== line.lineTotalVnd) {
        await tx.orderLine.update({
          where: { id: line.id },
          data: { plannedQty: q.plannedQty, deliveredQty: q.deliveredQty, lineTotalVnd: q.lineTotalVnd },
        });
      }
    }

    // An accepted order must stay fully delivered: reopening or editing a trip afterwards is refused.
    if (order.acceptedAt && !result.fullyDelivered && order.status !== OrderStatus.CANCELLED) {
      throw DomainError.conflict('ORDER_ACCEPTED', `${order.code} has a signed acceptance report; its deliveries can no longer change`);
    }
    const completedAt = result.status === OrderStatus.COMPLETED ? (order.completedAt ?? order.acceptedAt ?? new Date()) : null;
    await tx.order.update({
      where: { id: orderId },
      data: { totalVnd: result.totalVnd, paidVnd: result.paidVnd, status: result.status, completedAt },
    });

    if (result.status !== order.status) {
      await this.activity.log(tx, {
        orderId,
        entityType: 'ORDER',
        entityId: orderId,
        action: 'STATUS_CHANGED',
        fromValue: order.status,
        toValue: result.status,
        userId: actorId,
      });
    }
  }
}
