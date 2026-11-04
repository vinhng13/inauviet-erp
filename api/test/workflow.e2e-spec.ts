import { createTestApp, PASSWORD, resetDatabase, type Api, type TestContext } from './helpers';

/** Steps 2–6: confirm, design versions and approval, work order, delivery, signed acceptance. */
describe('order workflow (steps 2–6)', () => {
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
    customerId = (await t.api.post('/customers', { name: 'Chị Hạnh', phone: '0912 000 111', address: '5 Lê Lợi' }).expect(201)).body.id;
  });

  async function order(dueDate = '2026-11-20') {
    return (
      await t.api
        .post('/orders', {
          customerId,
          dueDate,
          lines: [{ description: 'Biển alu 2×0,6 m', quantity: 1, unitPriceVnd: 1_440_000 }],
          deliveries: [{ plannedDate: '2026-11-18', lines: [{ lineIndex: 0, plannedQty: 1 }] }],
          deposit: { amountVnd: 500_000, method: 'CASH' },
        })
        .expect(201)
    ).body;
  }

  async function account(name: string, permissions: string[]): Promise<Api> {
    const role = (await t.api.post('/roles', { name, permissions }).expect(201)).body;
    const username = name.toLowerCase().replace(/[^a-z]/g, '');
    await t.api.post('/accounts', { username, fullName: name, roleId: role.id, password: 'Tam-thoi-2026-ok' }).expect(201);
    const api = await t.login(username, 'Tam-thoi-2026-ok');
    await api.post('/auth/change-password', { currentPassword: 'Tam-thoi-2026-ok', newPassword: PASSWORD }).expect(204);
    return api;
  }

  it('walks the design path: versions, changes, approval, finishing, lock → work order', async () => {
    const o = await order();
    expect(o).toMatchObject({ status: 'CONFIRMED', confirmedAt: null, needsDesign: null, production: null });

    let r = (await t.api.post(`/orders/${o.id}/confirm`, { needsDesign: true }).expect(200)).body;
    expect(r).toMatchObject({ status: 'DESIGNING', needsDesign: true });
    await t.api.post(`/orders/${o.id}/confirm`, { needsDesign: true }).expect(409);

    const designer = await account('Thiet ke', ['design.work']);
    const designers = (await t.api.get('/designers').expect(200)).body;
    const me = designers.find((d: { fullName: string }) => d.fullName === 'Thiet ke');
    expect(me).toBeDefined();
    r = (await t.api.patch(`/orders/${o.id}/design`, { designerId: me.id }).expect(200)).body;
    expect(r.design.designer).toMatchObject({ fullName: 'Thiet ke' });

    const seen = (await designer.get(`/orders/${o.id}`).expect(200)).body;
    expect(JSON.stringify(seen)).not.toMatch(/Vnd/);
    await designer.patch(`/orders/${o.id}/design`, { designerId: null }).expect(403);

    r = (await designer.post(`/orders/${o.id}/design/versions`, { note: 'Gửi maket qua Zalo' }).expect(201)).body;
    expect(r.design.versions).toHaveLength(1);
    expect((await designer.post(`/orders/${o.id}/design/versions`).expect(409)).body.code).toBe('DESIGN_AWAITING_FEEDBACK');
    let queue = (await designer.get('/design-queue?mine=true').expect(200)).body;
    expect(queue[0]).toMatchObject({ code: o.code, state: 'WAITING', lastVersion: 1 });

    const v1 = r.design.versions[0].id;
    r = (await designer.post(`/orders/${o.id}/design/versions/${v1}/feedback`, { approved: false, note: 'Đổi màu chữ' }).expect(200)).body;
    expect(r.design.versions[0]).toMatchObject({ feedback: 'CHANGES_REQUESTED', feedbackNote: 'Đổi màu chữ' });
    expect((await designer.get('/design-queue').expect(200)).body[0].state).toBe('CHANGES');

    r = (await designer.post(`/orders/${o.id}/design/versions`).expect(201)).body;
    const v2 = r.design.versions[1];
    expect(v2).toMatchObject({ version: 2, note: 'Gửi bản sửa' });
    r = (await designer.post(`/orders/${o.id}/design/versions/${v2.id}/feedback`, { approved: true, channel: 'Email' }).expect(200)).body;
    expect(r).toMatchObject({ status: 'DESIGN_FINALIZING', design: { approvedVersion: 2, approvalChannel: 'Email', approvedByName: 'Chị Hạnh', finalizedAt: null } });

    // Customer changes their mind, then approves again.
    r = (await designer.post(`/orders/${o.id}/design/unapprove`, { reason: 'Khách muốn thêm logo' }).expect(200)).body;
    expect(r).toMatchObject({ status: 'DESIGNING', design: { approvedVersion: null } });
    r = (await designer.post(`/orders/${o.id}/design/versions`).expect(201)).body;
    r = (await designer.post(`/orders/${o.id}/design/versions/${r.design.versions[2].id}/feedback`, { approved: true }).expect(200)).body;
    expect(r.design).toMatchObject({ approvedVersion: 3, approvalChannel: 'Zalo' });

    expect((await designer.post(`/orders/${o.id}/design/lock`).expect(409)).body.code).toBe('DESIGN_NOT_FINALIZED');
    await designer.patch(`/orders/${o.id}/design/approval`, { finalized: true, approvedByName: 'Anh Tùng' }).expect(200);
    queue = (await designer.get('/design-queue').expect(200)).body;
    expect(queue[0]).toMatchObject({ state: 'FINAL', finalized: true });

    r = (await designer.post(`/orders/${o.id}/design/lock`).expect(200)).body;
    expect(r.status).toBe('IN_PRODUCTION');
    expect(r.design.lockedAt).not.toBeNull();
    expect(r.production).toMatchObject({ stage: 'RECEIVED', priority: 'NORMAL', dueDate: '2026-11-20' });
    expect(r.production.code).toMatch(/^LSX-\d{4}-0001$/);
    expect((await t.api.get('/design-queue').expect(200)).body).toEqual([]);

    const history = (await t.api.get(`/orders/${o.id}/activity`).expect(200)).body.map((h: { action: string }) => h.action);
    expect(history).toEqual(expect.arrayContaining(['ORDER_CONFIRMED', 'DESIGNER_ASSIGNED', 'DESIGN_SENT', 'DESIGN_CHANGES', 'DESIGN_APPROVED', 'DESIGN_REOPENED', 'DESIGN_LOCKED', 'PRODUCTION_STARTED']));
  });

  it('runs the workshop stages, hands over, delivers and needs the signed report to complete', async () => {
    const o = await order('2026-01-02');
    let r = (await t.api.post(`/orders/${o.id}/confirm`, { needsDesign: false }).expect(200)).body;
    expect(r).toMatchObject({ status: 'IN_PRODUCTION', production: { stage: 'RECEIVED' } });
    expect(r.design.versions).toEqual([]);

    const workshop = await account('Xuong', ['production.update']);
    let board = (await workshop.get('/production').expect(200)).body;
    expect(board[0]).toMatchObject({ code: o.code, source: 'File khách gửi', isLate: false });
    expect(JSON.stringify(board)).not.toMatch(/Vnd/);

    await workshop.patch(`/orders/${o.id}/production`, { priority: 'URGENT', dueDate: '2026-01-01' }).expect(200);
    expect((await workshop.post(`/orders/${o.id}/production/handover`).expect(409)).body.code).toBe('PRODUCTION_NOT_DONE');
    for (const stage of ['PRINTING', 'FINISHING', 'QC', 'DONE']) {
      r = (await workshop.post(`/orders/${o.id}/production/advance`).expect(200)).body;
      expect(r.production.stage).toBe(stage);
    }
    expect((await workshop.post(`/orders/${o.id}/production/advance`).expect(409)).body.code).toBe('PRODUCTION_DONE');
    board = (await workshop.get('/production').expect(200)).body;
    expect(board[0]).toMatchObject({ production: { priority: 'URGENT', stage: 'DONE' }, isLate: true });
    await workshop.post(`/orders/${o.id}/accept`, { signedBy: 'x' }).expect(403);

    r = (await workshop.post(`/orders/${o.id}/production/handover`).expect(200)).body;
    expect(r.status).toBe('DELIVERING');
    expect((await t.api.get('/production').expect(200)).body).toEqual([]);

    expect((await t.api.post(`/orders/${o.id}/accept`, { signedBy: 'Chị Hạnh' }).expect(409)).body.code).toBe('NOT_FULLY_DELIVERED');
    await t.api.post(`/deliveries/${o.deliveries[0].id}/deliver`).expect(200);
    r = (await t.api.post(`/orders/${o.id}/accept`, { signedBy: 'Chị Hạnh', note: 'Đủ hàng' }).expect(200)).body;
    expect(r).toMatchObject({ status: 'COMPLETED', acceptance: { acceptedByName: 'Chị Hạnh', note: 'Đủ hàng' } });
    expect(r.completedAt).not.toBeNull();

    expect((await t.api.post(`/deliveries/${o.deliveries[0].id}/reopen`, { reason: 'nhầm' }).expect(409)).body.code).toBe('ORDER_ACCEPTED');
    await t.api.post(`/orders/${o.id}/cancel`, { reason: 'x' }).expect(409);
  });

  it('board has the quote column and the 6 steps; receivables and receipts list money', async () => {
    const quote = (await t.api.post('/quotes', { customerId, lines: [{ description: 'Tờ rơi', unit: 'tờ', quantity: 1000, unitPriceVnd: 600 }] }).expect(201)).body;
    const a = await order();
    const b = await order();
    await t.api.post(`/orders/${b.id}/confirm`, { needsDesign: true }).expect(200);

    const board = (await t.api.get('/board').expect(200)).body;
    expect(board.quotes).toMatchObject({ count: 1, sentCount: 0 });
    expect(board.quotes.items[0].code).toBe(quote.code);
    expect(board.columns.map((c: { status: string }) => c.status)).toEqual(['CONFIRMED', 'DESIGNING', 'DESIGN_FINALIZING', 'IN_PRODUCTION', 'DELIVERING', 'COMPLETED']);
    expect(board.columns[0].orders[0].code).toBe(a.code);
    expect(board.columns[1].orders[0]).toMatchObject({ code: b.code, needsDesign: true, lastDesignVersion: null });

    await t.api.post(`/orders/${a.id}/confirm`, { needsDesign: false }).expect(200);
    await t.api.post(`/deliveries/${a.deliveries[0].id}/deliver`, { payment: { amountVnd: 400_000, method: 'CASH' } }).expect(200);

    const rec = (await t.api.get('/receivables').expect(200)).body;
    expect(rec).toMatchObject({ deliveredBalanceVnd: 540_000, upcomingBalanceVnd: 940_000, depositsHeldVnd: 500_000 });
    expect(rec.items.map((i: { orderCode: string; delivered: boolean }) => [i.orderCode, i.delivered])).toEqual([
      [a.code, true],
      [b.code, false],
    ]);
    expect((await t.api.get('/receivables?deliveredOnly=true').expect(200)).body.items).toHaveLength(1);

    const pays = (await t.api.get('/payments').expect(200)).body;
    expect(pays).toMatchObject({ total: 3, sumVnd: 1_400_000 });
    expect(pays.items[0]).toMatchObject({ customerName: 'Chị Hạnh' });
    expect((await t.api.get(`/payments?q=${b.code}`).expect(200)).body).toMatchObject({ total: 1, sumVnd: 500_000 });

    const designer = await account('Thiet ke', ['design.work']);
    await designer.get('/receivables').expect(403);
    const seen = (await designer.get('/board').expect(200)).body;
    expect(seen.quotes).toBeNull();
  });
});
