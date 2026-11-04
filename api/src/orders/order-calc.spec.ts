import { DeliveryStatus, OrderStatus } from '../generated/prisma/enums';
import { calculateOrder, type CalcInput } from './order-calc';

const banner = { id: 'banner', quantity: 10, unitPriceVnd: 500_000n };
const decal = { id: 'decal', quantity: 200, unitPriceVnd: 35_000n };

function base(overrides: Partial<CalcInput> = {}): CalcInput {
  return {
    status: OrderStatus.CONFIRMED,
    productionStartedAt: null,
    lines: [banner, decal],
    deliveries: [
      {
        status: DeliveryStatus.SCHEDULED,
        lines: [
          { orderLineId: 'banner', plannedQty: 10, deliveredQty: null },
          { orderLineId: 'decal', plannedQty: 100, deliveredQty: null },
        ],
      },
      { status: DeliveryStatus.SCHEDULED, lines: [{ orderLineId: 'decal', plannedQty: 100, deliveredQty: null }] },
    ],
    payments: [],
    ...overrides,
  };
}

describe('calculateOrder', () => {
  it('computes totals and planned quantities for the DH example', () => {
    const r = calculateOrder(base());
    expect(r.totalVnd).toBe(12_000_000n);
    expect(r.lines.get('banner')).toMatchObject({ plannedQty: 10, deliveredQty: 0, lineTotalVnd: 5_000_000n });
    expect(r.lines.get('decal')).toMatchObject({ plannedQty: 200, deliveredQty: 0 });
    expect(r.status).toBe(OrderStatus.CONFIRMED);
    expect(r.overPlanned).toEqual([]);
  });

  it('is IN_PRODUCTION once production started and nothing delivered', () => {
    expect(calculateOrder(base({ productionStartedAt: new Date() })).status).toBe(OrderStatus.IN_PRODUCTION);
  });

  it('walks the design steps once confirmed', () => {
    const confirmedAt = new Date();
    expect(calculateOrder(base({ confirmedAt, needsDesign: null })).status).toBe(OrderStatus.CONFIRMED);
    expect(calculateOrder(base({ confirmedAt, needsDesign: true })).status).toBe(OrderStatus.DESIGNING);
    expect(calculateOrder(base({ confirmedAt, needsDesign: true, designApprovedAt: new Date() })).status).toBe(OrderStatus.DESIGN_FINALIZING);
    expect(calculateOrder(base({ confirmedAt, needsDesign: true, designApprovedAt: new Date(), productionStartedAt: new Date() })).status).toBe(
      OrderStatus.IN_PRODUCTION,
    );
  });

  it('is DELIVERING once the workshop hands over, even before a trip', () => {
    expect(calculateOrder(base({ productionStartedAt: new Date(), productionDoneAt: new Date() })).status).toBe(OrderStatus.DELIVERING);
  });

  it('is DELIVERING after the first trip, stays DELIVERING when all is delivered, COMPLETED once accepted', () => {
    const input = base();
    input.deliveries[0].status = DeliveryStatus.DELIVERED;
    input.deliveries[0].lines.forEach((l) => (l.deliveredQty = l.plannedQty));
    expect(calculateOrder(input).status).toBe(OrderStatus.DELIVERING);

    input.deliveries[1].status = DeliveryStatus.DELIVERED;
    input.deliveries[1].lines[0].deliveredQty = 100;
    const r = calculateOrder(input);
    expect(r.status).toBe(OrderStatus.DELIVERING);
    expect(r.fullyDelivered).toBe(true);
    expect(r.lines.get('decal')!.deliveredQty).toBe(200);
    expect(calculateOrder({ ...input, acceptedAt: new Date() }).status).toBe(OrderStatus.COMPLETED);
  });

  it('returns the short quantity to "not yet planned"', () => {
    const input = base();
    input.deliveries.forEach((d) => {
      d.status = DeliveryStatus.DELIVERED;
      d.lines.forEach((l) => (l.deliveredQty = l.plannedQty));
    });
    input.deliveries[1].lines[0].deliveredQty = 80;
    const r = calculateOrder(input);
    expect(r.status).toBe(OrderStatus.DELIVERING);
    expect(r.lines.get('decal')).toMatchObject({ plannedQty: 180, deliveredQty: 180 });
  });

  it('ignores cancelled trips', () => {
    const input = base();
    input.deliveries[1].status = DeliveryStatus.CANCELLED;
    expect(calculateOrder(input).lines.get('decal')!.plannedQty).toBe(100);
  });

  it('flags over-planning', () => {
    const input = base();
    input.deliveries[1].lines[0].plannedQty = 120;
    expect(calculateOrder(input).overPlanned).toEqual([{ orderLineId: 'decal', planned: 220, ordered: 200 }]);
  });

  it('has a null total when no line has a price, and ignores voided payments', () => {
    const r = calculateOrder(
      base({
        lines: [{ ...banner, unitPriceVnd: null }, { ...decal, unitPriceVnd: null }],
        payments: [
          { amountVnd: 1_000_000n, voidedAt: null },
          { amountVnd: 500_000n, voidedAt: new Date() },
        ],
      }),
    );
    expect(r.totalVnd).toBeNull();
    expect(r.paidVnd).toBe(1_000_000n);
  });

  it('keeps CANCELLED regardless of deliveries', () => {
    const input = base({ status: OrderStatus.CANCELLED });
    input.deliveries[0].status = DeliveryStatus.DELIVERED;
    expect(calculateOrder(input).status).toBe(OrderStatus.CANCELLED);
  });
});
