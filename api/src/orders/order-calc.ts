import { DeliveryStatus, OrderStatus } from '../generated/prisma/enums';

/**
 * The single place where an order's derived numbers and status are worked out.
 * Every write that touches lines, deliveries or payments ends by running this inside the
 * same transaction (OrderRecalcService), so cached columns can never drift.
 *
 * Rules (spec v0.3, section 6):
 *  - line.deliveredQty = Σ deliveredQty on DELIVERED trips
 *  - line.plannedQty   = Σ plannedQty on SCHEDULED trips + line.deliveredQty
 *  - plannedQty must never exceed the ordered quantity
 *  - totalVnd = Σ priced line totals, null if no line has a price
 *  - paidVnd  = Σ non-voided payments
 *  - status follows the 6-step process (spec v0.7). CANCELLED stays. Otherwise the furthest step reached wins:
 *      acceptance report signed                   → COMPLETED      (step 6 done)
 *      a trip delivered, or workshop handed over  → DELIVERING     (step 6)
 *      production started                         → IN_PRODUCTION  (step 5)
 *      confirmed, needs design, customer approved → DESIGN_FINALIZING (step 4)
 *      confirmed, needs design                    → DESIGNING      (step 3)
 *      otherwise                                  → CONFIRMED      (step 2)
 *    Delivering everything no longer completes the order: the customer must sign the acceptance report.
 *    Payments never affect status.
 */
export interface CalcLine {
  id: string;
  quantity: number;
  unitPriceVnd: bigint | null;
}

export interface CalcDeliveryLine {
  orderLineId: string;
  plannedQty: number;
  deliveredQty: number | null;
}

export interface CalcDelivery {
  status: DeliveryStatus;
  lines: CalcDeliveryLine[];
}

export interface CalcPayment {
  amountVnd: bigint;
  voidedAt: Date | null;
}

export interface CalcInput {
  status: OrderStatus;
  confirmedAt?: Date | null;
  needsDesign?: boolean | null;
  designApprovedAt?: Date | null;
  productionStartedAt: Date | null;
  productionDoneAt?: Date | null;
  acceptedAt?: Date | null;
  lines: CalcLine[];
  deliveries: CalcDelivery[];
  payments: CalcPayment[];
}

export interface LineQuantities {
  plannedQty: number;
  deliveredQty: number;
  lineTotalVnd: bigint | null;
}

export interface OverPlannedLine {
  orderLineId: string;
  planned: number;
  ordered: number;
}

export interface CalcResult {
  lines: Map<string, LineQuantities>;
  totalVnd: bigint | null;
  paidVnd: bigint;
  status: OrderStatus;
  /** Every line delivered in full (the acceptance report can be signed) */
  fullyDelivered: boolean;
  overPlanned: OverPlannedLine[];
}

export function calculateOrder(input: CalcInput): CalcResult {
  const lines = new Map<string, LineQuantities>();
  let totalVnd: bigint | null = null;

  for (const line of input.lines) {
    const lineTotalVnd = line.unitPriceVnd === null ? null : BigInt(line.quantity) * line.unitPriceVnd;
    if (lineTotalVnd !== null) totalVnd = (totalVnd ?? 0n) + lineTotalVnd;
    lines.set(line.id, { plannedQty: 0, deliveredQty: 0, lineTotalVnd });
  }

  let anyDelivered = false;
  for (const d of input.deliveries) {
    if (d.status === DeliveryStatus.CANCELLED) continue;
    if (d.status === DeliveryStatus.DELIVERED) anyDelivered = true;
    for (const dl of d.lines) {
      const q = lines.get(dl.orderLineId);
      if (!q) continue;
      if (d.status === DeliveryStatus.DELIVERED) {
        const delivered = dl.deliveredQty ?? 0;
        q.deliveredQty += delivered;
        q.plannedQty += delivered;
      } else {
        q.plannedQty += dl.plannedQty;
      }
    }
  }

  const overPlanned: OverPlannedLine[] = [];
  for (const line of input.lines) {
    const q = lines.get(line.id)!;
    if (q.plannedQty > line.quantity) {
      overPlanned.push({ orderLineId: line.id, planned: q.plannedQty, ordered: line.quantity });
    }
  }

  const paidVnd = input.payments.reduce((sum, p) => (p.voidedAt ? sum : sum + p.amountVnd), 0n);

  const fullyDelivered = anyDelivered && input.lines.every((l) => lines.get(l.id)!.deliveredQty >= l.quantity);

  let status: OrderStatus;
  if (input.status === OrderStatus.CANCELLED) status = OrderStatus.CANCELLED;
  else if (input.acceptedAt) status = OrderStatus.COMPLETED;
  else if (anyDelivered || input.productionDoneAt) status = OrderStatus.DELIVERING;
  else if (input.productionStartedAt) status = OrderStatus.IN_PRODUCTION;
  else if (input.confirmedAt && input.needsDesign) status = input.designApprovedAt ? OrderStatus.DESIGN_FINALIZING : OrderStatus.DESIGNING;
  else status = OrderStatus.CONFIRMED;

  return { lines, totalVnd, paidVnd, status, fullyDelivered, overPlanned };
}
