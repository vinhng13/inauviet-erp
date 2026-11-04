import { createTestApp, resetDatabase, STAFF, type TestContext } from './helpers';

/**
 * The worked example from the spec: Công ty ABC orders 10 banners + 200 decals on two trips,
 * pays a deposit, the driver collects money on each trip, and the order completes once the customer signs
 * the acceptance report.
 */
describe('order → delivery → payment flow', () => {
  let t: TestContext;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    const c = await t.api.post('/customers', { name: 'Anh Minh', companyName: 'Công ty ABC', phone: '0903 123 456', address: '12 Nguyễn Huệ' }).expect(201);
    customerId = c.body.id;
  });

  async function createExampleOrder() {
    const res = await t.api
      .post('/orders', {
        customerId,
        orderDate: '2026-10-27',
        dueDate: '2026-11-05',
        lines: [
          { description: 'Banner hiflex 2×1 m', quantity: 10, unitPriceVnd: 500_000 },
          { description: 'Decal PP 30×40 cm', quantity: 200, unitPriceVnd: 35_000 },
        ],
        deliveries: [
          { plannedDate: '2026-11-02', lines: [{ lineIndex: 0, plannedQty: 10 }, { lineIndex: 1, plannedQty: 100 }] },
          { plannedDate: '2026-11-04', lines: [{ lineIndex: 1, plannedQty: 100 }] },
        ],
        deposit: { amountVnd: 3_000_000, method: 'BANK_TRANSFER' },
      })
      .expect(201);
    return res.body;
  }

  it('creates the order with its plan, deposit and codes', async () => {
    const o = await createExampleOrder();
    expect(o.code).toMatch(/^DH-\d{4}-0001$/);
    expect(o.status).toBe('CONFIRMED');
    expect(o.totalVnd).toBe(12_000_000);
    expect(o.paidVnd).toBe(3_000_000);
    expect(o.balanceVnd).toBe(9_000_000);
    expect(o.paymentStatus).toBe('PARTLY_PAID');
    expect(o.unplannedQty).toBe(0);
    expect(o.deliveries).toHaveLength(2);
    expect(o.deliveries[0]).toMatchObject({ status: 'SCHEDULED', plannedDate: '2026-11-02', address: '12 Nguyễn Huệ', valueVnd: 8_500_000 });
    expect(o.customer.phone).toBe('0903123456');
  });

  it('runs the whole example to COMPLETED and PAID', async () => {
    const o = await createExampleOrder();
    await t.api.post(`/orders/${o.id}/confirm`, { needsDesign: false }).expect(200).expect((r) => expect(r.body.status).toBe('IN_PRODUCTION'));

    const [trip1, trip2] = o.deliveries;
    const d1 = await t.api.post(`/deliveries/${trip1.id}/deliver`, { receiverName: 'Chị Lan', payment: { amountVnd: 5_500_000, method: 'CASH' } }).expect(200);
    expect(d1.body).toMatchObject({ status: 'DELIVERED', collectedVnd: 5_500_000, orderStatus: 'DELIVERING' });

    const mid = (await t.api.get(`/orders/${o.id}`).expect(200)).body;
    expect(mid.status).toBe('DELIVERING');
    expect(mid.lines[1]).toMatchObject({ deliveredQty: 100, plannedQty: 200, unplannedQty: 0 });

    await t.api.post(`/deliveries/${trip2.id}/deliver`, { payment: { amountVnd: 3_500_000, method: 'CASH' } }).expect(200);
    expect((await t.api.get(`/orders/${o.id}`)).body).toMatchObject({ status: 'DELIVERING', fullyDelivered: true, acceptance: null });
    await t.api.post(`/orders/${o.id}/accept`, { signedBy: 'Anh Minh' }).expect(200);
    const done = (await t.api.get(`/orders/${o.id}`).expect(200)).body;
    expect(done.acceptance).toMatchObject({ acceptedByName: 'Anh Minh' });
    expect(done).toMatchObject({ status: 'COMPLETED', paidVnd: 12_000_000, balanceVnd: 0, paymentStatus: 'PAID' });
    expect(done.completedAt).not.toBeNull();
    expect(done.payments.map((p: { deliveryCode: string | null }) => p.deliveryCode)).toEqual([null, trip1.code, trip2.code]);

    const history = (await t.api.get(`/orders/${o.id}/activity`).expect(200)).body;
    const statuses = history.filter((h: { action: string }) => h.action === 'STATUS_CHANGED').map((h: { toValue: string }) => h.toValue);
    expect(statuses).toEqual(['COMPLETED', 'DELIVERING', 'IN_PRODUCTION']);
  });

  it('returns a short delivery to "not yet planned" and completes after a new trip', async () => {
    const o = await createExampleOrder();
    const [trip1, trip2] = o.deliveries;
    const decalId = o.lines[1].id;
    await t.api.post(`/deliveries/${trip1.id}/deliver`).expect(200);
    await t.api.post(`/deliveries/${trip2.id}/deliver`, { lines: [{ orderLineId: decalId, deliveredQty: 80 }] }).expect(200);

    let order = (await t.api.get(`/orders/${o.id}`)).body;
    expect(order.status).toBe('DELIVERING');
    expect(order.lines[1]).toMatchObject({ deliveredQty: 180, unplannedQty: 20 });
    const board = (await t.api.get('/board?hasUnplanned=true')).body;
    expect(board.columns.find((c: { status: string }) => c.status === 'DELIVERING').orders[0]).toMatchObject({ code: o.code, unplannedQty: 20, tripsDelivered: 2, tripsTotal: 2 });

    const trip3 = await t.api.post(`/orders/${o.id}/deliveries`, { plannedDate: '2026-11-06', lines: [{ orderLineId: decalId, plannedQty: 20 }] }).expect(201);
    expect(trip3.body.code).toMatch(/^GH-\d{4}-0003$/);
    await t.api.post(`/deliveries/${trip3.body.id}/deliver`).expect(200);
    order = (await t.api.post(`/orders/${o.id}/accept`, { signedBy: 'Anh Minh' }).expect(200)).body;
    expect(order.status).toBe('COMPLETED');
  });

  it('refuses to plan more than ordered', async () => {
    const o = await createExampleOrder();
    const res = await t.api.post(`/orders/${o.id}/deliveries`, { plannedDate: '2026-11-06', lines: [{ orderLineId: o.lines[1].id, plannedQty: 1 }] }).expect(409);
    expect(res.body.code).toBe('PLANNED_QTY_EXCEEDS_ORDER');
    expect(res.body.details.lines[0]).toMatchObject({ planned: 201, ordered: 200, description: 'Decal PP 30×40 cm' });
  });

  it('refuses delivering more than planned and lowering an ordered quantity below the plan', async () => {
    const o = await createExampleOrder();
    const r1 = await t.api.post(`/deliveries/${o.deliveries[1].id}/deliver`, { lines: [{ orderLineId: o.lines[1].id, deliveredQty: 101 }] }).expect(400);
    expect(r1.body.code).toBe('DELIVERED_EXCEEDS_PLANNED');

    const r2 = await t.api
      .put(`/orders/${o.id}/lines`, {
        lines: [
          { id: o.lines[0].id, description: 'Banner hiflex 2×1 m', quantity: 10, unitPriceVnd: 500_000 },
          { id: o.lines[1].id, description: 'Decal PP 30×40 cm', quantity: 150, unitPriceVnd: 35_000 },
        ],
      })
      .expect(409);
    expect(r2.body.code).toBe('PLANNED_QTY_EXCEEDS_ORDER');
  });

  it('cancelling a trip frees its quantity; cancelling the order cancels scheduled trips', async () => {
    const o = await createExampleOrder();
    await t.api.post(`/deliveries/${o.deliveries[1].id}/cancel`, { reason: 'Khách dời lịch' }).expect(200);
    let order = (await t.api.get(`/orders/${o.id}`)).body;
    expect(order.unplannedQty).toBe(100);

    await t.api.post(`/orders/${o.id}/cancel`, { reason: 'Khách huỷ' }).expect(200);
    order = (await t.api.get(`/orders/${o.id}`)).body;
    expect(order.status).toBe('CANCELLED');
    expect(order.deliveries.every((d: { status: string }) => d.status === 'CANCELLED')).toBe(true);
    await t.api.post(`/orders/${o.id}/deliveries`, { plannedDate: '2026-11-06', lines: [{ orderLineId: o.lines[1].id, plannedQty: 1 }] }).expect(409);
  });

  it('works without any prices', async () => {
    const res = await t.api
      .post('/orders', { customerId, lines: [{ description: 'Standee', quantity: 3 }], deliveries: [{ plannedDate: '2026-11-03', lines: [{ lineIndex: 0, plannedQty: 3 }] }] })
      .expect(201);
    expect(res.body).toMatchObject({ totalVnd: null, balanceVnd: null, paymentStatus: 'NONE' });
    expect(res.body.deliveries[0].valueVnd).toBeNull();
  });

  it('reopen and void need their own permissions; staff without them gets 403', async () => {
    const o = await createExampleOrder();
    const staff = await t.login(STAFF);
    await staff.post(`/deliveries/${o.deliveries[0].id}/deliver`).expect(200);
    const r = await staff.post(`/deliveries/${o.deliveries[0].id}/reopen`, { reason: 'nhầm' }).expect(403);
    expect(r.body).toMatchObject({ code: 'PERMISSION_DENIED', details: { missing: ['deliveries.reopen'] } });
    await staff.post(`/payments/${o.payments[0].id}/void`, { reason: 'nhầm' }).expect(403);

    await t.api.post(`/deliveries/${o.deliveries[0].id}/reopen`, { reason: 'Bấm nhầm' }).expect(200);
    const order = (await t.api.get(`/orders/${o.id}`)).body;
    expect(order.status).toBe('CONFIRMED');
    await t.api.post(`/payments/${o.payments[0].id}/void`, { reason: 'Nhập nhầm' }).expect(200);
    expect((await t.api.get(`/orders/${o.id}`)).body.paidVnd).toBe(0);
  });
});
