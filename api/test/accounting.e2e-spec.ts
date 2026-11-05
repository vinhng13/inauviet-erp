import { periodInZone } from '../src/common/utils/dates';
import { resetDatabase, createTestApp, STAFF, type TestContext } from './helpers';

/** One month of books end to end: setup, vouchers, month-end steps, closing, CRM postings, reopening. */
describe('Accounting', () => {
  let t: TestContext;
  const now = new Date();
  const yymm = periodInZone('Asia/Ho_Chi_Minh', now);
  const m1 = `20${yymm.slice(0, 2)}-${yymm.slice(2)}`;
  const prev = (() => {
    const [y, m] = m1.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  })();
  const d = (day: number) => `${prev}-${String(day).padStart(2, '0')}`;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('runs a month from opening balances to closing, then posts the CRM into the next month', async () => {
    const api = t.api;
    expect((await api.get('/accounting/periods').expect(200)).body.periods).toEqual([]);
    expect((await api.post('/accounting/entries', { date: d(5), description: 'x', lines: [{ account: '111', debitVnd: 1, creditVnd: 0 }, { account: '411', debitVnd: 0, creditVnd: 1 }] }).expect(409)).body.code).toBe('BOOKS_NOT_STARTED');

    const { id: p0 } = (await api.post('/accounting/periods/start', { month: prev }).expect(201)).body;
    expect((await api.post('/accounting/periods/start', { month: prev }).expect(409)).body.code).toBe('BOOKS_STARTED');

    // Catalogs
    const { id: sup } = (await api.post('/accounting/suppliers', { name: 'Công ty Giấy Sài Gòn' }).expect(201)).body;
    expect((await api.post('/accounting/suppliers', { name: 'công ty giấy sài gòn' }).expect(409)).body.code).toBe('SUPPLIER_NAME_TAKEN');
    const { id: mat } = (await api.post('/accounting/materials', { code: 'vt-dpp', name: 'Decal PP', unit: 'm²' }).expect(201)).body;
    expect((await api.get('/accounting/suppliers').expect(200)).body[0].code).toBe('NCC-0001');
    expect((await api.get('/accounting/materials').expect(200)).body[0].code).toBe('VT-DPP');

    // Openings: 111 50M, 211 24M, 152 (from stock) 2M = 411 72M + 214 4M
    await api.put('/accounting/openings', { lines: [
      { account: '111', debitVnd: 50_000_000, creditVnd: 0 },
      { account: '211', debitVnd: 24_000_000, creditVnd: 0 },
      { account: '214', debitVnd: 0, creditVnd: 4_000_000 },
      { account: '411', debitVnd: 0, creditVnd: 72_000_000 },
    ] }).expect(200);
    let openings = (await api.put('/accounting/openings/stock', { lines: [{ materialId: mat, qty: 100, priceVnd: 20_000 }] }).expect(200)).body;
    expect(openings).toMatchObject({ differenceVnd: 0, editable: true });
    expect(openings.lines.find((l: { account: string }) => l.account === '152').openingVnd).toBe(2_000_000);

    // Vouchers
    await api.post('/accounting/receipts', { date: d(3), supplierId: sup, payMethod: 'CREDIT', vatRate: 8, lines: [{ materialId: mat, qty: 100, priceVnd: 22_000 }] }).expect(201);
    expect((await api.post('/accounting/issues', { date: d(4), lines: [{ materialId: mat, qty: 500 }] }).expect(409)).body.code).toBe('STOCK_SHORT');
    await api.post('/accounting/issues', { date: d(4), note: 'Dùng chung', lines: [{ materialId: mat, qty: 50 }] }).expect(201);
    const cats = (await api.get(`/accounting/periods/${p0}/cash`).expect(200)).body.categories;
    const rent = cats.find((c: { name: string }) => c.name === 'Thuê mặt bằng').id;
    await api.post('/accounting/cash-payments', { date: d(5), description: 'Tiền thuê tháng', categoryId: rent, amountVnd: 5_000_000, vatRate: 0, method: 'CASH' }).expect(201);
    await api.post('/accounting/assets', { kind: 'FIXED_ASSET', name: 'Máy in khổ lớn', costVnd: 24_000_000, startMonth: prev, months: 24, expenseAccount: '6422' }).expect(201);

    let stock = (await api.get(`/accounting/periods/${p0}/stock`).expect(200)).body;
    expect(stock.rows[0]).toMatchObject({ openQty: 100, inQty: 100, outQty: 50, endQty: 150, priceVnd: 21_000 });
    expect(stock.issues[0].valueVnd).toBe(1_050_000);

    // Month-end, in order
    expect((await api.post(`/accounting/periods/${p0}/steps/vat`).expect(409)).body.code).toBe('STEP_ORDER');
    expect((await api.post(`/accounting/periods/${p0}/close`).expect(409)).body.code).toBe('STEPS_PENDING');
    for (const step of ['price', 'depreciation', 'allocation', 'vat', 'transfer']) await api.post(`/accounting/periods/${p0}/steps/${step}`).expect(200);
    const ov = (await api.get(`/accounting/periods/${p0}/overview`).expect(200)).body;
    expect(ov.canClose).toBe(true);
    expect(ov.kpi).toMatchObject({ cashVnd: 45_000_000, stockVnd: 3_150_000, payableVnd: 2_376_000, profitVnd: -7_050_000 });

    // A posting after the steps resets them
    const { id: pkt } = (await api.post('/accounting/entries', { date: d(20), description: 'Góp thêm vốn', lines: [{ account: '111', debitVnd: 1_000_000, creditVnd: 0 }, { account: '411', debitVnd: 0, creditVnd: 1_000_000 }] }).expect(201)).body;
    expect((await api.get(`/accounting/periods/${p0}/overview`).expect(200)).body.period.stepsDone).toEqual([]);
    await api.delete(`/accounting/entries/${pkt}`).expect(204);
    for (const step of ['price', 'depreciation', 'allocation', 'vat', 'transfer']) await api.post(`/accounting/periods/${p0}/steps/${step}`).expect(200);

    const journal = (await api.get(`/accounting/periods/${p0}/journal`).expect(200)).body;
    const codes = journal.entries.map((e: { code: string }) => e.code);
    const mc = prev.slice(2, 4) + prev.slice(5, 7);
    expect(codes).toEqual(expect.arrayContaining([`KH-${mc}`, `KC-${mc}-01`, `KC-${mc}-03`, `KC-${mc}-04`]));
    expect(codes).not.toContain(`KT-${mc}`); // no output VAT to offset

    await api.post(`/accounting/periods/${p0}/close`).expect(200);
    expect((await api.post('/accounting/entries', { date: d(25), description: 'x', lines: [{ account: '111', debitVnd: 1, creditVnd: 0 }, { account: '411', debitVnd: 0, creditVnd: 1 }] }).expect(409)).body.code).toBe('PERIOD_CLOSED');
    expect((await api.put('/accounting/openings', { lines: [] }).expect(409)).body.code).toBe('OPENINGS_LOCKED');

    // Next month carries the balances
    let periods = (await api.get('/accounting/periods').expect(200)).body.periods;
    const p1 = periods.find((p: { month: string }) => p.month === m1);
    expect(periods.find((p: { id: string }) => p.id === p0)).toMatchObject({ status: 'CLOSED', profitVnd: -7_050_000, provisional: false, canReopen: true });
    let tb = (await api.get(`/accounting/periods/${p1.id}/journal`).expect(200)).body.trialBalance;
    const opening = (a: string) => tb.find((r: { account: string }) => r.account === a)?.openingVnd;
    expect([opening('111'), opening('152'), opening('331'), opening('1331'), opening('421'), opening('214')]).toEqual([45_000_000, 3_150_000, -2_376_000, 176_000, 7_050_000, -5_000_000]);
    stock = (await api.get(`/accounting/periods/${p1.id}/stock`).expect(200)).body;
    expect(stock.rows[0]).toMatchObject({ openQty: 150, openPriceVnd: 21_000 });

    // CRM: an accepted order with a payment this month posts DT and PT
    const admin = await t.prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const customer = await t.prisma.customer.create({ data: { code: 'KH-0001', name: 'Chị Hạnh', phone: '0901234567', searchText: 'chi hanh' } });
    const order = await t.prisma.order.create({ data: { code: `DH-${yymm}-0001`, customerId: customer.id, orderDate: now, status: 'COMPLETED', totalVnd: 10_000_000n, paidVnd: 4_000_000n, acceptedAt: now, completedAt: now, createdById: admin.id } });
    const payment = await t.prisma.payment.create({ data: { orderId: order.id, amountVnd: 4_000_000n, method: 'BANK_TRANSFER', paidOn: now, recordedById: admin.id } });
    tb = (await api.get(`/accounting/periods/${p1.id}/journal`).expect(200)).body;
    const dt = tb.entries.find((e: { code: string }) => e.code === `DT-${yymm}-0001`);
    expect(dt.lines.map((l: { account: string; debitVnd: number; creditVnd: number }) => [l.account, l.debitVnd || -l.creditVnd])).toEqual([['131', 10_800_000], ['511', -10_000_000], ['33311', -800_000]]);
    expect(dt.canDelete).toBe(false);
    expect(tb.entries.some((e: { kind: string }) => e.kind === 'CUSTOMER_RECEIPT')).toBe(true);
    const debts = (await api.get(`/accounting/periods/${p1.id}/debts`).expect(200)).body;
    expect(debts.receivables[0]).toMatchObject({ customerName: 'Chị Hạnh', oweVnd: 6_800_000 });
    expect(debts.payables[0]).toMatchObject({ supplierName: 'Công ty Giấy Sài Gòn', balanceVnd: 2_376_000 });
    const tax = (await api.get(`/accounting/periods/${p1.id}/tax`).expect(200)).body;
    expect(tax).toMatchObject({ outputVnd: 800_000, inputVnd: 0, carriedInVnd: 176_000, payableVnd: 624_000 });
    // Lines of an accepted order are final
    expect((await api.put(`/orders/${order.id}/lines`, { lines: [{ description: 'Banner', quantity: 1, unitPriceVnd: 1000 }] }).expect(409)).body.code).toBe('ORDER_COMPLETED');

    // Voiding the payment in an open month removes its PT; syncing twice posts nothing twice
    await t.prisma.payment.update({ where: { id: payment.id }, data: { voidedAt: new Date(), voidReason: 'nhầm' } });
    tb = (await api.get(`/accounting/periods/${p1.id}/journal`).expect(200)).body;
    expect(tb.entries.filter((e: { kind: string }) => e.kind === 'CUSTOMER_RECEIPT')).toHaveLength(0);
    expect(tb.entries.filter((e: { kind: string }) => e.kind === 'REVENUE')).toHaveLength(1);

    const gl = (await api.get(`/accounting/periods/${p1.id}/ledger?account=131`).expect(200)).body;
    expect(gl).toMatchObject({ openingVnd: 0, debitVnd: 10_800_000, closingVnd: 10_800_000 });
    const pnl = (await api.get('/accounting/reports/pnl').expect(200)).body.columns;
    expect(pnl.at(-2)).toMatchObject({ revenueVnd: 10_000_000, provisional: true });

    // Material issued to the accepted order becomes its cost of goods at month end
    const today = new Date().toISOString().slice(0, 10);
    await api.post('/accounting/issues', { date: today.slice(0, 7) === m1 ? today : `${m1}-01`, orderId: order.id, lines: [{ materialId: mat, qty: 10 }] }).expect(201);
    await api.post(`/accounting/periods/${p1.id}/steps/price`).expect(200);
    const gv = (await api.get(`/accounting/periods/${p1.id}/journal`).expect(200)).body.entries.find((e: { code: string }) => e.code === `GV-${yymm}-0001`);
    expect(gv.lines.map((l: { account: string; debitVnd: number; creditVnd: number }) => [l.account, l.debitVnd || -l.creditVnd])).toEqual([['632', 210_000], ['154', -210_000]]);

    // Reopen the closed month
    await api.post(`/accounting/periods/${p0}/reopen`, { reason: 'Sửa phiếu chi' }).expect(200);
    periods = (await api.get('/accounting/periods').expect(200)).body;
    expect(periods.periods.find((p: { id: string }) => p.id === p0)).toMatchObject({ status: 'OPEN', stepsDone: [] });
    expect(periods.log.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['PERIOD_CLOSED', 'PERIOD_REOPENED', 'STEP_RUN']));
    expect((await api.post(`/accounting/periods/${p1.id}/steps/price`).expect(409)).body.code).toBe('PREVIOUS_PERIOD_OPEN');
  });

  it('keeps the books to accounting permissions', async () => {
    const staff = await t.login(STAFF);
    await staff.get('/accounting/periods').expect(403);
    await staff.post('/accounting/periods/start', { month: '2026-01' }).expect(403);
  });
});
