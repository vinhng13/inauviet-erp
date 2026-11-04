import { createTestApp, resetDatabase, STAFF, type TestContext } from './helpers';

/**
 * Steps 1–2 of the process: products in the catalog, a quote priced per m² and per unit,
 * closing it into an order, then swapping a product and changing a quantity on the order.
 */
describe('catalog → quote → order', () => {
  let t: TestContext;
  let customerId: string;
  let decalId: string;
  let decalSuaId: string;
  let standeeId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    customerId = (await t.api.post('/customers', { name: 'Chị Thảo', companyName: 'Spa An Nhiên', phone: '0905 000 505' }).expect(201)).body.id;
    decalId = (await t.api.post('/products', { name: 'Decal PP in UV', category: 'Decal', pricingMode: 'AREA', unitPriceVnd: 180_000 }).expect(201)).body.id;
    decalSuaId = (await t.api.post('/products', { name: 'Decal sữa cán mờ', category: 'Decal', pricingMode: 'AREA', unitPriceVnd: 150_000 }).expect(201)).body.id;
    standeeId = (await t.api.post('/products', { name: 'Standee chữ X', category: 'Standee', pricingMode: 'UNIT', unit: 'bộ', unitPriceVnd: 250_000 }).expect(201)).body.id;
  });

  const quoteBody = () => ({
    customerId,
    title: 'Decal kính + standee khai trương',
    lines: [
      { productId: decalId, widthM: 1.2, heightM: 0.8, quantity: 4 },
      { productId: standeeId, quantity: 2 },
      { description: 'Công lắp đặt', quantity: 1, unitPriceVnd: 300_000 },
    ],
  });

  it('manages the catalog', async () => {
    const list = await t.api.get('/products').expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Decal PP in UV', 'Decal sữa cán mờ', 'Standee chữ X']);
    expect(list.body[0]).toMatchObject({ unit: 'm²', unitPriceVnd: 180000 });
    await t.api.post('/products', { name: 'Decal PP in UV', category: 'Decal', pricingMode: 'AREA', unitPriceVnd: 1 }).expect(409);
    await t.api.post('/products', { name: 'Biển', category: 'Biển', pricingMode: 'UNIT', unitPriceVnd: 1 }).expect(400);
    await t.api.patch(`/products/${standeeId}`, { isActive: false }).expect(200);
    const active = await t.api.get('/products?active=true').expect(200);
    expect(active.body).toHaveLength(2);
  });

  it('prices a quote on the server', async () => {
    const q = (await t.api.post('/quotes', quoteBody()).expect(201)).body;
    expect(q.code).toMatch(/^BG-\d{4}-0001$/);
    expect(q.status).toBe('DRAFT');
    expect(q.lines[0]).toMatchObject({ description: 'Decal PP in UV', unit: 'tấm', areaM2: 3.84, areaPriceVnd: 180000, unitPriceVnd: 172800, lineTotalVnd: 691200 });
    expect(q.lines[1]).toMatchObject({ unit: 'bộ', unitPriceVnd: 250000, lineTotalVnd: 500000 });
    expect(q.totalVnd).toBe(691200 + 500000 + 300000);
    expect(q.validUntil > q.quoteDate).toBe(true);

    const bad = await t.api.post('/quotes', { customerId, lines: [{ productId: decalId, quantity: 1 }] }).expect(400);
    expect(bad.body.code).toBe('LINE_SIZE_REQUIRED');
  });

  it('sends, loses and reopens a quote', async () => {
    const q = (await t.api.post('/quotes', quoteBody()).expect(201)).body;
    expect((await t.api.post(`/quotes/${q.id}/send`).expect(200)).body.status).toBe('SENT');
    const lost = await t.api.post(`/quotes/${q.id}/lose`, { reason: 'Khách chọn bên khác' }).expect(200);
    expect(lost.body).toMatchObject({ status: 'LOST', lostReason: 'Khách chọn bên khác' });
    expect((await t.api.put(`/quotes/${q.id}`, quoteBody()).expect(409)).body.code).toBe('QUOTE_LOST');
    expect((await t.api.post(`/quotes/${q.id}/reopen`).expect(200)).body.status).toBe('SENT');
    const list = await t.api.get('/quotes?status=SENT').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.counts).toEqual({ DRAFT: 0, SENT: 1, WON: 0, LOST: 0 });
    const history = await t.api.get(`/quotes/${q.id}/activity`).expect(200);
    expect(history.body.map((h: { action: string }) => h.action)).toContain('QUOTE_CREATED');
  });

  it('closes into an order and tracks what changed against the quote', async () => {
    const q = (await t.api.post('/quotes', quoteBody()).expect(201)).body;
    const closed = await t.api.post(`/quotes/${q.id}/close`, { dueDate: '2026-11-10' }).expect(200);
    expect(closed.body.orderCode).toMatch(/^DH-\d{4}-0001$/);
    expect((await t.api.get(`/quotes/${q.id}`).expect(200)).body).toMatchObject({ status: 'WON', order: { code: closed.body.orderCode } });
    await t.api.post(`/quotes/${q.id}/close`).expect(409);

    let order = (await t.api.get(`/orders/${closed.body.orderId}`).expect(200)).body;
    expect(order.quote).toMatchObject({ code: q.code, totalVnd: q.totalVnd, changes: [] });
    expect(order.totalVnd).toBe(q.totalVnd);
    expect(order.lines[0]).toMatchObject({ description: 'Decal PP in UV 1,2×0,8 m', baseName: 'Decal PP in UV', widthM: 1.2, heightM: 0.8, unit: 'tấm', unitPriceVnd: 172800 });

    // Step 2: swap the decal for decal sữa, 5 pieces instead of 4, drop the installation, keep the standee
    const [decal, standee] = order.lines;
    order = (
      await t.api
        .put(`/orders/${order.id}/lines`, {
          lines: [
            { id: decal.id, productId: decalSuaId, description: 'Decal sữa cán mờ', widthM: 1.2, heightM: 0.8, quantity: 5 },
            { id: standee.id, productId: standeeId, description: standee.description, quantity: 2, unitPriceVnd: 250_000 },
          ],
        })
        .expect(200)
    ).body;
    expect(order.lines[0]).toMatchObject({ description: 'Decal sữa cán mờ 1,2×0,8 m', areaPriceVnd: 150000, unitPriceVnd: 144000, lineTotalVnd: 720000 });
    expect(order.quote.changes).toEqual([
      expect.objectContaining({ kind: 'CHANGED', description: 'Decal sữa cán mờ 1,2×0,8 m', fromDescription: 'Decal PP in UV 1,2×0,8 m', fromQuantity: 4, toQuantity: 5, priceChanged: true }),
      expect.objectContaining({ kind: 'REMOVED', description: 'Công lắp đặt' }),
    ]);
    const history = (await t.api.get(`/orders/${order.id}/activity`).expect(200)).body;
    const change = history.find((h: { action: string }) => h.action === 'LINES_CHANGED');
    expect(change.data.changes).toEqual([
      'Bỏ "Công lắp đặt"',
      'Đổi "Decal PP in UV 1,2×0,8 m" → "Decal sữa cán mờ 1,2×0,8 m"',
      '"Decal sữa cán mờ 1,2×0,8 m": số lượng 4 → 5',
      '"Decal sữa cán mờ 1,2×0,8 m": đổi đơn giá',
    ]);
  });

  it('checks permissions', async () => {
    const staff = await t.login(STAFF); // the old staff group: orders, no quote permissions
    await staff.get('/quotes').expect(403);
    await staff.post('/products', { name: 'X', category: 'Y', pricingMode: 'UNIT', unit: 'cái', unitPriceVnd: 1 }).expect(403);
  });
});
