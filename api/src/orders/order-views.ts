import type { Prisma } from '../generated/prisma/client';
import { DeliveryStatus, OrderStatus } from '../generated/prisma/enums';
import { formatDateOnly } from '../common/utils/dates';
import { paymentStatus, toVnd } from '../common/utils/money';
import { toCustomerDto } from '../customers/customers.service';
import type { DeliveryDto, DeliveryListItemDto } from '../deliveries/deliveries.dto';
import type { PaymentDto } from '../payments/payments.dto';
import { orderLineDescription } from '../quotes/line-pricing';
import type { OrderCardDto, OrderDetailDto, OrderLineDto, OrderQuoteDto, QuoteChangeDto } from './orders.dto';
import type { OrderProductionDto } from './workflow.dto';

/** Query shapes and mappers from database rows to API responses. */

export const deliveryInclude = {
  lines: { include: { orderLine: { select: { description: true, unitPriceVnd: true, sortOrder: true } } } },
  payments: { select: { amountVnd: true, voidedAt: true } },
} satisfies Prisma.DeliveryInclude;

export const orderDetailInclude = {
  customer: true,
  quote: { select: { id: true, code: true, totalVnd: true, lines: { orderBy: { sortOrder: 'asc' } } } },
  lines: { orderBy: { sortOrder: 'asc' } },
  designer: { select: { id: true, fullName: true } },
  designs: { orderBy: { version: 'asc' }, include: { createdBy: { select: { fullName: true } } } },
  deliveries: { orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }], include: deliveryInclude },
  payments: {
    orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
    include: { delivery: { select: { code: true } }, recordedBy: { select: { fullName: true } } },
  },
} satisfies Prisma.OrderInclude;

export const orderCardInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  lines: { select: { description: true, quantity: true, plannedQty: true, deliveredQty: true }, orderBy: { sortOrder: 'asc' } },
  deliveries: { select: { status: true, plannedDate: true } },
  designer: { select: { fullName: true } },
  designs: { select: { version: true, feedback: true }, orderBy: { version: 'desc' }, take: 1 },
  quote: { select: { id: true, code: true } },
} satisfies Prisma.OrderInclude;

type DeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;
type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;
type OrderCardRow = Prisma.OrderGetPayload<{ include: typeof orderCardInclude }>;
type PaymentRow = OrderDetailRow['payments'][number];

export const OPEN_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.DESIGNING,
  OrderStatus.DESIGN_FINALIZING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.DELIVERING,
];
const OPEN = OPEN_STATUSES;

/** Every line delivered in full (and at least one line) */
export function isFullyDelivered(lines: Array<{ quantity: number; deliveredQty: number }>): boolean {
  return lines.length > 0 && lines.every((l) => l.deliveredQty >= l.quantity);
}

export function toProductionDto(o: {
  productionStartedAt: Date | null;
  productionCode: string | null;
  productionStage: OrderProductionDto['stage'];
  productionDueDate: Date | null;
  productionPriority: OrderProductionDto['priority'];
  productionNote: string | null;
  productionDoneAt: Date | null;
}): OrderProductionDto | null {
  if (!o.productionStartedAt) return null;
  return {
    code: o.productionCode,
    stage: o.productionStage,
    dueDate: formatDateOnly(o.productionDueDate),
    priority: o.productionPriority,
    note: o.productionNote,
    startedAt: o.productionStartedAt.toISOString(),
    doneAt: o.productionDoneAt?.toISOString() ?? null,
  };
}

function isOrderOverdue(status: OrderStatus, dueDate: Date | null, today: string): boolean {
  return OPEN.includes(status) && dueDate !== null && formatDateOnly(dueDate) < today;
}

const dec = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

/** "Decal PP 1,2×0,8 m" → "Decal PP" for lines that carry a size */
export function baseName(description: string, widthM: number | null): string {
  return widthM === null ? description : description.replace(/\s+\d+(?:,\d+)?×\d+(?:,\d+)?\s*m$/, '');
}

export function toLineDto(l: OrderDetailRow['lines'][number]): OrderLineDto {
  const widthM = dec(l.widthM);
  return {
    id: l.id,
    description: l.description,
    baseName: baseName(l.description, widthM),
    productId: l.productId,
    spec: l.spec,
    unit: l.unit,
    widthM,
    heightM: dec(l.heightM),
    areaPriceVnd: toVnd(l.areaPriceVnd),
    quantity: l.quantity,
    plannedQty: l.plannedQty,
    deliveredQty: l.deliveredQty,
    unplannedQty: Math.max(0, l.quantity - l.plannedQty),
    unitPriceVnd: toVnd(l.unitPriceVnd),
    lineTotalVnd: toVnd(l.lineTotalVnd),
    sortOrder: l.sortOrder,
  };
}

export function toDeliveryDto(d: DeliveryRow, today: string): DeliveryDto {
  let value: bigint | null = null;
  const lines = [...d.lines].sort((a, b) => a.orderLine.sortOrder - b.orderLine.sortOrder);
  for (const dl of lines) {
    const qty = d.status === DeliveryStatus.DELIVERED ? (dl.deliveredQty ?? 0) : dl.plannedQty;
    if (dl.orderLine.unitPriceVnd !== null) value = (value ?? 0n) + BigInt(qty) * dl.orderLine.unitPriceVnd;
  }
  const collected = d.payments.reduce((s, p) => (p.voidedAt ? s : s + p.amountVnd), 0n);
  return {
    id: d.id,
    code: d.code,
    orderId: d.orderId,
    status: d.status,
    plannedDate: formatDateOnly(d.plannedDate),
    isOverdue: d.status === DeliveryStatus.SCHEDULED && formatDateOnly(d.plannedDate) < today,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    address: d.address,
    receiverName: d.receiverName,
    note: d.note,
    cancelReason: d.cancelReason,
    valueVnd: toVnd(d.status === DeliveryStatus.CANCELLED ? null : value),
    collectedVnd: Number(collected),
    lines: lines.map((dl) => ({
      id: dl.id,
      orderLineId: dl.orderLineId,
      description: dl.orderLine.description,
      plannedQty: dl.plannedQty,
      deliveredQty: dl.deliveredQty,
    })),
    createdAt: d.createdAt.toISOString(),
  };
}

export function toDeliveryListItem(
  d: DeliveryRow & { order: { code: string; status: OrderStatus; customer: { name: string; phone: string } } },
  today: string,
): DeliveryListItemDto {
  return {
    ...toDeliveryDto(d, today),
    orderCode: d.order.code,
    orderStatus: d.order.status,
    customerName: d.order.customer.name,
    customerPhone: d.order.customer.phone,
  };
}

export function toPaymentDto(p: PaymentRow): PaymentDto {
  return {
    id: p.id,
    orderId: p.orderId,
    deliveryId: p.deliveryId,
    deliveryCode: p.delivery?.code ?? null,
    amountVnd: Number(p.amountVnd),
    method: p.method,
    paidOn: formatDateOnly(p.paidOn),
    isDeposit: p.isDeposit,
    note: p.note,
    recordedByName: p.recordedBy?.fullName ?? null,
    createdAt: p.createdAt.toISOString(),
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidReason: p.voidReason,
  };
}

/** Compare the order with the quote it came from, line by line (order lines remember their quote line). */
export function quoteChanges(o: OrderDetailRow): OrderQuoteDto | null {
  if (!o.quote) return null;
  const changes: QuoteChangeDto[] = [];
  const byQuoteLine = new Map(o.lines.filter((l) => l.quoteLineId).map((l) => [l.quoteLineId!, l]));
  for (const ql of o.quote.lines) {
    const fromDescription = orderLineDescription({ description: ql.description, widthM: dec(ql.widthM), heightM: dec(ql.heightM) });
    const ol = byQuoteLine.get(ql.id);
    if (!ol) {
      changes.push({ kind: 'REMOVED', description: fromDescription, fromDescription: null, fromQuantity: ql.quantity, toQuantity: null, priceChanged: false, fromLineTotalVnd: Number(ql.lineTotalVnd), toLineTotalVnd: null });
      continue;
    }
    const nameChanged = ol.description !== fromDescription;
    const qtyChanged = ol.quantity !== ql.quantity;
    const priceChanged = ol.unitPriceVnd !== ql.unitPriceVnd;
    if (nameChanged || qtyChanged || priceChanged) {
      changes.push({
        kind: 'CHANGED',
        description: ol.description,
        fromDescription: nameChanged ? fromDescription : null,
        fromQuantity: qtyChanged ? ql.quantity : null,
        toQuantity: qtyChanged ? ol.quantity : null,
        priceChanged,
        fromLineTotalVnd: Number(ql.lineTotalVnd),
        toLineTotalVnd: toVnd(ol.lineTotalVnd),
      });
    }
  }
  for (const ol of o.lines) {
    if (ol.quoteLineId && o.quote.lines.some((ql) => ql.id === ol.quoteLineId)) continue;
    changes.push({ kind: 'ADDED', description: ol.description, fromDescription: null, fromQuantity: null, toQuantity: ol.quantity, priceChanged: false, fromLineTotalVnd: null, toLineTotalVnd: toVnd(ol.lineTotalVnd) });
  }
  return { id: o.quote.id, code: o.quote.code, totalVnd: Number(o.quote.totalVnd), changes };
}

export function toOrderDetail(o: OrderDetailRow, today: string): OrderDetailDto {
  const lines = o.lines.map(toLineDto);
  return {
    id: o.id,
    code: o.code,
    quote: quoteChanges(o),
    status: o.status,
    orderDate: formatDateOnly(o.orderDate),
    dueDate: formatDateOnly(o.dueDate),
    isOverdue: isOrderOverdue(o.status, o.dueDate, today),
    note: o.note,
    cancelReason: o.cancelReason,
    customer: toCustomerDto(o.customer),
    lines,
    deliveries: o.deliveries.map((d) => toDeliveryDto(d, today)),
    payments: o.payments.map(toPaymentDto),
    unplannedQty: o.status === OrderStatus.CANCELLED ? 0 : lines.reduce((s, l) => s + l.unplannedQty, 0),
    totalVnd: toVnd(o.totalVnd),
    paidVnd: Number(o.paidVnd),
    balanceVnd: o.totalVnd === null ? null : Number(o.totalVnd - o.paidVnd),
    paymentStatus: paymentStatus(o.totalVnd, o.paidVnd),
    productionStartedAt: o.productionStartedAt?.toISOString() ?? null,
    confirmedAt: o.confirmedAt?.toISOString() ?? null,
    needsDesign: o.needsDesign,
    design: {
      designer: o.designer,
      versions: o.designs.map((v) => ({
        id: v.id,
        version: v.version,
        sentAt: v.sentAt.toISOString(),
        note: v.note,
        feedback: v.feedback,
        feedbackAt: v.feedbackAt?.toISOString() ?? null,
        feedbackNote: v.feedbackNote,
        createdByName: v.createdBy.fullName,
      })),
      approvedAt: o.designApprovedAt?.toISOString() ?? null,
      approvedVersion: o.approvedVersion,
      approvalChannel: o.approvalChannel,
      approvedByName: o.approvedByName,
      finalizedAt: o.designFinalizedAt?.toISOString() ?? null,
      lockedAt: o.designLockedAt?.toISOString() ?? null,
    },
    production: toProductionDto(o),
    fullyDelivered: isFullyDelivered(o.lines),
    acceptance: o.acceptedAt ? { acceptedAt: o.acceptedAt.toISOString(), acceptedByName: o.acceptedByName, note: o.acceptanceNote } : null,
    completedAt: o.completedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

export function toOrderCard(o: OrderCardRow, today: string): OrderCardDto {
  const active = o.deliveries.filter((d) => d.status !== DeliveryStatus.CANCELLED);
  const next = active
    .filter((d) => d.status === DeliveryStatus.SCHEDULED)
    .map((d) => formatDateOnly(d.plannedDate))
    .sort()[0];
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    customerId: o.customer.id,
    customerCode: o.customer.code,
    customerName: o.customer.name,
    customerPhone: o.customer.phone,
    orderDate: formatDateOnly(o.orderDate),
    dueDate: formatDateOnly(o.dueDate),
    isOverdue: isOrderOverdue(o.status, o.dueDate, today),
    summary: summarize(o.lines.map((l) => l.description)),
    tripsTotal: active.length,
    tripsDelivered: active.filter((d) => d.status === DeliveryStatus.DELIVERED).length,
    nextPlannedDate: next ?? null,
    unplannedQty: o.status === OrderStatus.CANCELLED ? 0 : o.lines.reduce((s, l) => s + Math.max(0, l.quantity - l.plannedQty), 0),
    totalVnd: toVnd(o.totalVnd),
    paidVnd: Number(o.paidVnd),
    paymentStatus: paymentStatus(o.totalVnd, o.paidVnd),
    completedAt: o.completedAt?.toISOString() ?? null,
    needsDesign: o.needsDesign,
    designerName: o.designer?.fullName ?? null,
    lastDesignVersion: o.designs[0]?.version ?? null,
    lastDesignFeedback: o.designs[0]?.feedback ?? null,
    approvedVersion: o.approvedVersion,
    approvalChannel: o.approvalChannel,
    designFinalized: o.designFinalizedAt !== null,
    productionCode: o.productionCode,
    productionStage: o.productionStage,
    productionDueDate: formatDateOnly(o.productionDueDate),
    productionPriority: o.productionPriority,
    fullyDelivered: isFullyDelivered(o.lines),
    quote: o.quote,
  };
}

function summarize(descriptions: string[]): string {
  if (descriptions.length <= 2) return descriptions.join(', ');
  return `${descriptions.slice(0, 2).join(', ')} +${descriptions.length - 2}`;
}
