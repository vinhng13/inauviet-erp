import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { normalizePermissions } from '../src/access/permissions';
import { hashPassword } from '../src/auth/password';
import { ADMIN, createTestApp, PASSWORD, resetDatabase, type Api, type TestContext } from './helpers';

/** Phân hệ Kho: vật tư theo khổ, phiếu, tồn, kiểm kê, khuôn và vòng luân chuyển. */
describe('Warehouse', () => {
  let t: TestContext;
  let keeper: Api; // Thủ kho: slip, dies, count (không manage)
  let staff: Api;
  let requester: Api; // Lan: thủ kho bạt, chỉ lập phiếu ở kho giấy
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
    const role = await t.prisma.role.create({ data: { name: 'Thủ kho', permissions: normalizePermissions(['warehouse.slip', 'warehouse.dies', 'warehouse.count']) } });
    await t.prisma.user.create({ data: { username: 'kho', fullName: 'Hà Thủ kho', roleId: role.id, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false } });
    await t.prisma.user.create({ data: { username: 'kho2', fullName: 'Lan Thủ kho bạt', roleId: role.id, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false } });
    keeper = await t.login('kho');
    requester = await t.login('kho2');
    staff = await t.login('staff');
  });
  afterAll(() => t.app.close());

  let giay: { id: string; code: string };
  let bat: { id: string; code: string };
  let paperId: string;
  let spec18: string;
  let spec27: string;
  let glueSpec: string;
  let ramUnit: string;
  const stockOf = async (api: Api, warehouseId: string, specId: string) =>
    (await api.get(`/warehouse/stock?warehouseId=${warehouseId}`).expect(200)).body.find((i: { specId: string }) => i.specId === specId);

  it('has the warehouses from the migration; storekeepers are set per warehouse', async () => {
    const list = (await keeper.get('/warehouse/warehouses').expect(200)).body;
    expect(list.map((w: { code: string }) => w.code)).toEqual(['GIAY', 'BAT', 'OFFSET', 'KHUON']);
    giay = list[0];
    bat = list[1];
    const ha = await t.prisma.user.findFirstOrThrow({ where: { username: 'kho' } });
    const lan = await t.prisma.user.findFirstOrThrow({ where: { username: 'kho2' } });
    expect((await keeper.put(`/warehouse/warehouses/${giay.id}`, { code: 'GIAY', name: 'Kho giấy', keeperIds: [ha.id] }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    await t.api.put(`/warehouse/warehouses/${giay.id}`, { code: 'GIAY', name: 'Kho giấy', keeperIds: [ha.id] }).expect(204);
    await t.api.put(`/warehouse/warehouses/${bat.id}`, { code: 'BAT', name: 'Kho vật tư xưởng bạt', keeperIds: [lan.id] }).expect(204);
    await t.api.post('/warehouse/warehouses', { code: 'X2', name: 'Kho xưởng 2', keeperIds: [] }).expect(204);
    expect((await t.api.post('/warehouse/warehouses', { code: 'X2', name: 'Trùng', keeperIds: [] }).expect(409)).body.code).toBe('WH_WAREHOUSE_EXISTS');
    const mine = (await keeper.get('/warehouse/warehouses').expect(200)).body;
    expect(mine.find((w: { code: string }) => w.code === 'GIAY')).toMatchObject({ canConfirm: true, keepers: [{ fullName: 'Hà Thủ kho' }] });
    expect(mine.find((w: { code: string }) => w.code === 'BAT').canConfirm).toBe(false);
  });

  it('keeps one material catalog with sizes, units (factor per size) and the warehouses that hold it', async () => {
    expect((await staff.get('/warehouse/materials').expect(403)).body.code).toBe('PERMISSION_DENIED');
    const base = { group: 'Giấy', name: 'Giấy ngoại IC 145', unit: 'tờ', hasSizes: true, units: [], warehouseIds: [giay.id] };
    expect((await t.api.post('/warehouse/materials', { ...base, specs: [{ widthCm: 18, lengthCm: 50.5 }, { widthCm: 18, lengthCm: 50.5 }] }).expect(400)).body.code).toBe('WH_SIZE_DUPLICATE');
    expect((await t.api.post('/warehouse/materials', { ...base, specs: [{ widthCm: 18, lengthCm: 50.5 }], units: [{ name: 'tờ', factor: 1 }] }).expect(400)).body.code).toBe('WH_UNIT_IS_BASE');
    await t.api.post('/warehouse/materials', {
      ...base,
      code: 'GN-IC145',
      specs: [{ widthCm: 18, lengthCm: 50.5 }, { widthCm: 27, lengthCm: 23 }],
      // ram = 500 tờ, nhưng khổ 27 x 23 đóng ram 250 tờ
      units: [{ name: 'ram', factor: 500 }, { name: 'ram', factor: 250, widthCm: 27, lengthCm: 23 }],
    }).expect(204);
    await t.api.post('/warehouse/materials', { group: 'Keo', name: 'Keo sữa', unit: 'kg', hasSizes: false, specs: [], units: [{ name: 'thùng', factor: 20 }], warehouseIds: [giay.id, bat.id] }).expect(204);
    expect((await t.api.post('/warehouse/materials', { group: 'Keo', name: 'Keo sữa', unit: 'kg', hasSizes: false, specs: [], units: [], warehouseIds: [] }).expect(409)).body.code).toBe('WH_MATERIAL_EXISTS');

    const mats = (await keeper.get('/warehouse/materials').expect(200)).body;
    const paper = mats.find((m: { name: string }) => m.name === 'Giấy ngoại IC 145');
    paperId = paper.id;
    expect(paper.specs.map((p: { label: string }) => p.label)).toEqual(['18 x 50,5', '27 x 23']);
    expect(paper.units.map((u: { name: string; factor: number; specLabel: string | null }) => [u.name, u.factor, u.specLabel])).toEqual([['ram', 500, null], ['ram', 250, '27 x 23']]);
    spec18 = paper.specs[0].id;
    spec27 = paper.specs[1].id;
    glueSpec = mats.find((m: { name: string }) => m.name === 'Keo sữa').specs[0].id;

    const s18 = await stockOf(keeper, giay.id, spec18);
    expect(s18).toMatchObject({ label: 'Giấy ngoại IC 145 · 18 x 50,5', qty: 0, warehouseCode: 'GIAY' });
    expect(s18.units.map((u: { name: string; factor: number }) => [u.name, u.factor])).toEqual([['tờ', 1], ['ram', 500]]);
    ramUnit = s18.units[1].id;
    expect((await stockOf(keeper, giay.id, spec27)).units.map((u: { factor: number }) => u.factor)).toEqual([1, 250]);
    expect(await stockOf(keeper, bat.id, spec18)).toBeUndefined();
    expect(await stockOf(keeper, bat.id, glueSpec)).toMatchObject({ warehouseCode: 'BAT', qty: 0 });
  });

  let receiptId: string;

  it('slips wait for the storekeeper; stock changes only on confirmation', async () => {
    // Lan (kho2) is not the paper storekeeper: her receipt waits
    const r = (await requester.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: today, reference: 'HĐ 123', confirm: true, lines: [{ specId: spec18, unitId: ramUnit, qty: 1, unitPriceVnd: 600000 }, { specId: glueSpec, qty: 12.5 }] }).expect(201)).body;
    expect(r).toMatchObject({ status: 'PENDING', canConfirm: false, canCancel: true, warehouseCode: 'GIAY' });
    expect(r.code).toMatch(/^NK-GIAY-\d{4}-\d{4}$/);
    expect(r.lines[0]).toMatchObject({ qty: 500, unitName: 'ram', unitQty: 1 });
    expect((await stockOf(keeper, giay.id, spec18)).qty).toBe(0);
    expect((await requester.post(`/warehouse/slips/${r.id}/confirm`).expect(403)).body.code).toBe('WH_NOT_KEEPER');
    const ok = (await keeper.post(`/warehouse/slips/${r.id}/confirm`).expect(201)).body;
    expect(ok).toMatchObject({ status: 'CONFIRMED', confirmedBy: 'Hà Thủ kho' });
    expect((await keeper.post(`/warehouse/slips/${r.id}/confirm`).expect(409)).body.code).toBe('WH_SLIP_NOT_PENDING');
    receiptId = r.id;

    // the storekeeper's own slip can be confirmed straight away
    expect((await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'ISSUE', date: today, lines: [{ specId: spec18, qty: 1 }] }).expect(400)).body.code).toBe('WH_RECEIVER_REQUIRED');
    const issue = (await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'ISSUE', date: today, receiver: 'Anh Tuấn', purpose: 'In túi', reference: 'LSX 88', confirm: true, lines: [{ specId: spec18, qty: 320 }] }).expect(201)).body;
    expect(issue.status).toBe('CONFIRMED');
    // short stock is refused at confirmation
    const big = (await requester.post('/warehouse/slips', { warehouseId: giay.id, kind: 'ISSUE', date: today, receiver: 'Xưởng', lines: [{ specId: spec18, qty: 600 }] }).expect(201)).body;
    expect((await stockOf(keeper, giay.id, spec18)).pendingOut).toBe(600);
    expect((await keeper.post(`/warehouse/slips/${big.id}/confirm`).expect(400)).body.code).toBe('WH_STOCK_SHORT');
    const rej = (await keeper.post(`/warehouse/slips/${big.id}/reject`, { reason: 'không đủ giấy' }).expect(201)).body;
    expect(rej).toMatchObject({ status: 'REJECTED', rejectReason: 'không đủ giấy' });
    // the requester cancels her own pending slip
    const ret = (await requester.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RETURN', date: today, receiver: 'Anh Tuấn', lines: [{ specId: spec18, qty: 20 }] }).expect(201)).body;
    expect((await requester.post(`/warehouse/slips/${ret.id}/cancel`).expect(201)).body.status).toBe('CANCELLED');
    await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RETURN', date: today, receiver: 'Anh Tuấn', confirm: true, lines: [{ specId: spec18, qty: 20 }] }).expect(201);
    // a size not held by the warehouse is refused
    expect((await keeper.post('/warehouse/slips', { warehouseId: bat.id, kind: 'RECEIPT', date: today, lines: [{ specId: spec18, qty: 1 }] }).expect(400)).body.code).toBe('WH_ITEM_NOT_IN_WAREHOUSE');

    const row = await stockOf(keeper, giay.id, spec18);
    expect(row).toMatchObject({ qty: 200, pendingOut: 0 });
    expect(row).not.toHaveProperty('valueVnd'); // money is hidden without money.view
    expect((await stockOf(t.api, giay.id, spec18)).valueVnd).toBe(240000); // 600.000đ / ram = 1.200đ / tờ
    expect((await stockOf(keeper, giay.id, glueSpec)).qty).toBe(12.5);

    const card = (await keeper.get(`/warehouse/stock/${row.id}/card`).expect(200)).body;
    expect(card.rows.map((x: { inQty: number; outQty: number; balance: number }) => [x.inQty, x.outQty, x.balance])).toEqual([[20, 0, 200], [0, 320, 180], [500, 0, 500]]);
    expect((await keeper.post(`/warehouse/slips/${receiptId}/void`, { reason: 'nhập nhầm' }).expect(400)).body.code).toBe('WH_VOID_NEGATIVE');
  });

  it('transfers from warehouse A to B: A confirms sending, then B confirms receiving', async () => {
    const tr = (await keeper.post('/warehouse/transfers', { fromWarehouseId: giay.id, toWarehouseId: bat.id, date: today, reference: 'decal dùng chung', lines: [{ specId: spec18, qty: 50 }] }).expect(201)).body;
    expect(tr).toMatchObject({ kind: 'TRANSFER_OUT', status: 'PENDING', warehouseCode: 'GIAY', counterpart: { warehouseCode: 'BAT', status: 'PENDING' } });
    expect(tr.code).toMatch(/^CK-GIAY-/);
    expect(tr.counterpart.code).toMatch(/^CK-BAT-/);
    // the receiving storekeeper cannot receive before it is sent
    expect((await requester.post(`/warehouse/slips/${tr.counterpart.id}/confirm`).expect(409)).body.code).toBe('WH_TRANSFER_NOT_SENT');
    await keeper.post(`/warehouse/slips/${tr.id}/confirm`).expect(201);
    expect((await stockOf(keeper, giay.id, spec18)).qty).toBe(150);
    expect((await stockOf(keeper, bat.id, spec18)).qty).toBe(0); // material added to BAT, nothing received yet
    const transit = (await requester.get('/warehouse/overview').expect(200)).body;
    expect(transit.inTransit.map((s: { id: string }) => s.id)).toEqual([tr.counterpart.id]);
    expect(transit.toConfirm.map((s: { id: string }) => s.id)).toEqual([tr.counterpart.id]);
    expect((await keeper.post(`/warehouse/slips/${tr.counterpart.id}/confirm`).expect(403)).body.code).toBe('WH_NOT_KEEPER');
    expect((await requester.post(`/warehouse/slips/${tr.counterpart.id}/reject`, { reason: 'x' }).expect(409)).body.code).toBe('WH_TRANSFER_SENT');
    await requester.post(`/warehouse/slips/${tr.counterpart.id}/confirm`).expect(201);
    expect((await stockOf(keeper, bat.id, spec18)).qty).toBe(50);

    // voiding a transfer reverses both sides
    const tr2 = (await keeper.post('/warehouse/transfers', { fromWarehouseId: giay.id, toWarehouseId: bat.id, date: today, confirm: true, lines: [{ specId: spec18, qty: 10 }] }).expect(201)).body;
    expect(tr2.status).toBe('CONFIRMED');
    await keeper.post(`/warehouse/slips/${tr2.id}/void`, { reason: 'chuyển nhầm' }).expect(201);
    const both = (await keeper.get(`/warehouse/slips/${tr2.id}`).expect(200)).body;
    expect(both.voidedAt).not.toBeNull();
    expect(both.counterpart.status).toBe('CANCELLED');
    expect((await stockOf(keeper, giay.id, spec18)).qty).toBe(150);
    expect((await keeper.post('/warehouse/transfers', { fromWarehouseId: giay.id, toWarehouseId: giay.id, date: today, lines: [{ specId: spec18, qty: 1 }] }).expect(400)).body.code).toBe('WH_TRANSFER_SAME');
  });

  it('a size that has slips cannot be changed; a warehouse with stock cannot be removed from a material', async () => {
    const body = { group: 'Giấy', name: 'Giấy ngoại IC 145', unit: 'tờ', hasSizes: true, units: [], warehouseIds: [giay.id, bat.id] };
    expect((await t.api.put(`/warehouse/materials/${paperId}`, { ...body, specs: [{ id: spec18, widthCm: 19, lengthCm: 50.5 }, { id: spec27, widthCm: 27, lengthCm: 23 }] }).expect(409)).body.code).toBe('WH_SIZE_IN_USE');
    expect((await t.api.put(`/warehouse/materials/${paperId}`, { ...body, warehouseIds: [giay.id], specs: [{ id: spec18, widthCm: 18, lengthCm: 50.5 }, { id: spec27, widthCm: 27, lengthCm: 23 }] }).expect(409)).body.code).toBe('WH_MATERIAL_HAS_STOCK');
  });

  it('counts stock per warehouse; the storekeeper approves the difference', async () => {
    const c = (await keeper.post('/warehouse/counts', { warehouseId: giay.id, date: today, groups: ['Giấy'] }).expect(201)).body;
    expect(c.code).toMatch(/^KKV-GIAY-/);
    expect(c.lines.map((l: { specId: string }) => l.specId).sort()).toEqual([spec18, spec27].sort());
    expect((await keeper.post('/warehouse/counts', { warehouseId: giay.id, date: today }).expect(409)).body.code).toBe('WH_COUNT_OPEN');
    await keeper.put(`/warehouse/counts/${c.id}`, { entries: [{ specId: spec18, countedQty: 145 }, { specId: spec27, countedQty: 40 }] }).expect(200);
    expect((await requester.post(`/warehouse/counts/${c.id}/approve`).expect(403)).body.code).toBe('WH_NOT_KEEPER');
    const done = (await keeper.post(`/warehouse/counts/${c.id}/approve`).expect(201)).body;
    expect(done).toMatchObject({ status: 'APPROVED' });
    expect(done.adjustSlipCode).toMatch(/^DC-GIAY-/);
    expect((await stockOf(keeper, giay.id, spec18)).qty).toBe(145);
    expect((await stockOf(keeper, giay.id, spec27)).qty).toBe(40);
  });

  it('reports in – out – balance, stock as of a day, and saves end-of-day snapshots', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    // a slip dated yesterday, so a snapshot of yesterday has something in it
    await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: yesterday, confirm: true, lines: [{ specId: spec27, qty: 10 }] }).expect(201);
    const rep = (await keeper.get(`/warehouse/reports/stock?warehouseId=${giay.id}&from=${today}&to=${today}`).expect(200)).body;
    const r18 = rep.rows.find((r: { specId: string }) => r.specId === spec18);
    // today: +500 receipt, −320 issue, +20 return, −50 transfer, −5 count adjustment (150 → 145)
    expect(r18).toMatchObject({ opening: 0, inQty: 520, outQty: 375, closing: 145 });
    expect(rep.rows.find((r: { specId: string }) => r.specId === spec27)).toMatchObject({ opening: 10, closing: 50 });

    const live = (await keeper.get(`/warehouse/reports/as-of?warehouseId=${giay.id}&date=${yesterday}`).expect(200)).body;
    expect(live.source).toBe('LIVE');
    expect(live.rows.find((r: { specId: string }) => r.specId === spec27).qty).toBe(10);

    expect((await keeper.post('/warehouse/snapshots/run').expect(403)).body.code).toBe('PERMISSION_DENIED');
    const run = (await t.api.post('/warehouse/snapshots/run').expect(201)).body;
    expect(run.days).toBeGreaterThan(0);
    expect((await t.api.post('/warehouse/snapshots/run').expect(201)).body.days).toBe(0); // nothing left to take
    // a later slip dated yesterday changes the live figure, not the snapshot
    await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: yesterday, confirm: true, lines: [{ specId: spec27, qty: 5 }] }).expect(201);
    const snap = (await keeper.get(`/warehouse/reports/as-of?warehouseId=${giay.id}&date=${yesterday}`).expect(200)).body;
    expect(snap.source).toBe('SNAPSHOT');
    expect(snap.rows.find((r: { specId: string }) => r.specId === spec27)).toMatchObject({ qty: 10, liveQty: 15 });
  });

  it('locks a month per warehouse: no slips dated in it there', async () => {
    const month = today.slice(0, 7);
    await t.api.post('/warehouse/month-locks', { warehouseId: giay.id, month }).expect(204);
    expect((await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: today, lines: [{ specId: spec27, qty: 1 }] }).expect(400)).body.code).toBe('WH_MONTH_LOCKED');
    await requester.post('/warehouse/slips', { warehouseId: bat.id, kind: 'RECEIPT', date: today, lines: [{ specId: glueSpec, qty: 1 }] }).expect(201); // other warehouse still open
    await t.api.delete(`/warehouse/month-locks/${giay.id}/${month}`).expect(204);
  });

  let mlId: string;
  let shelfId: string;
  let dieId: string;
  let die2Id: string;

  it('creates dies with fixed codes and warns about near-duplicate sizes', async () => {
    await t.api.post('/warehouse/partners', { name: 'Mê Linh', kind: 'DIE_SHOP' }).expect(204);
    await t.api.post('/warehouse/locations', { code: 'T4-K01' }).expect(204);
    mlId = (await keeper.get('/warehouse/partners').expect(200)).body[0].id;
    shelfId = (await keeper.get('/warehouse/locations').expect(200)).body[0].id;

    const a = (await keeper.post('/warehouse/dies', { symbolCode: 'TUI', productName: 'Túi giấy Orien', lengthCm: 21, widthCm: 30, heightCm: 10, locationId: shelfId }).expect(201)).body;
    expect(a).toMatchObject({ code: 'TUI-001', status: 'READY', place: 'Kho · T4-K01', size: '21 x 30 x 10' });
    dieId = a.id;

    const near = await keeper.post('/warehouse/dies', { symbolCode: 'TUI', productName: 'Túi khác', lengthCm: 21.3, widthCm: 30, heightCm: 10 }).expect(409);
    expect(near.body.code).toBe('WH_DIE_SIMILAR_EXISTS');
    expect(near.body.details.similar[0].code).toBe('TUI-001');
    const b = (await keeper.post('/warehouse/dies', { symbolCode: 'TUI', productName: 'Túi khác', lengthCm: 21.3, widthCm: 30, heightCm: 10, force: true }).expect(201)).body;
    expect(b).toMatchObject({ code: 'TUI-002', status: 'CHECKING' });
    die2Id = b.id;

    const found = (await keeper.get('/warehouse/dies?l=21&w=30&tol=0.5').expect(200)).body;
    expect(found.items.map((d: { code: string }) => d.code)).toEqual(['TUI-001', 'TUI-002']);
    expect((await keeper.get('/warehouse/dies?q=orien').expect(200)).body.items.map((d: { code: string }) => d.code)).toEqual(['TUI-001']);
  });

  it('follows the die life cycle; wrong steps are refused', async () => {
    const issue = { action: 'ISSUE', date: today, partnerId: mlId, expectedBackOn: '2020-01-01', reference: 'LSX 88' };
    let d = (await keeper.post(`/warehouse/dies/${dieId}/actions`, issue).expect(201)).body;
    expect(d).toMatchObject({ status: 'IN_USE', place: 'Mê Linh', overdue: true });
    expect((await keeper.post(`/warehouse/dies/${dieId}/actions`, issue).expect(409)).body.code).toBe('WH_DIE_ACTION_NOT_ALLOWED');
    expect((await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'PASS', date: today, locationId: shelfId }).expect(409)).body.code).toBe('WH_DIE_ACTION_NOT_ALLOWED');

    d = (await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'KEEP', date: today }).expect(201)).body;
    expect(d).toMatchObject({ status: 'READY', place: 'Mê Linh', expectedBackOn: null });

    d = (await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'RETURN', date: today }).expect(201)).body;
    expect(d).toMatchObject({ status: 'CHECKING', holderId: null });
    expect((await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'PASS', date: today }).expect(400)).body.code).toBe('WH_LOCATION_REQUIRED');
    d = (await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'PASS', date: today, locationId: shelfId }).expect(201)).body;
    expect(d).toMatchObject({ status: 'READY', place: 'Kho · T4-K01' });
    expect(d.moves.map((m: { action: string }) => m.action)).toEqual(['PASS', 'RETURN', 'KEEP', 'ISSUE', 'CREATE']);
    expect(d.allowedActions).toEqual(expect.arrayContaining(['ISSUE', 'MOVE', 'DISPOSE']));

    // defect → repair → back → pass
    await keeper.post(`/warehouse/dies/${die2Id}/actions`, { action: 'DEFECT', date: today, note: 'mẻ dao' }).expect(201);
    await keeper.post(`/warehouse/dies/${die2Id}/actions`, { action: 'SEND_REPAIR', date: today }).expect(400);
    await keeper.post(`/warehouse/dies/${die2Id}/actions`, { action: 'SEND_REPAIR', date: today, partnerId: mlId }).expect(201);
    d = (await keeper.post(`/warehouse/dies/${die2Id}/actions`, { action: 'BACK_REPAIR', date: today }).expect(201)).body;
    expect(d.status).toBe('CHECKING');
  });

  it('hands several dies over in one batch', async () => {
    await keeper.post(`/warehouse/dies/${die2Id}/actions`, { action: 'PASS', date: today, locationId: shelfId }).expect(201);
    const out = (await keeper.post('/warehouse/batches', { kind: 'OUT', date: today, partnerId: mlId, dieIds: [dieId, die2Id], reference: 'LSX 90' }).expect(201)).body;
    expect(out.code).toMatch(/^GN/);
    expect(out.dies.map((d: { status: string }) => d.status)).toEqual(['IN_USE', 'IN_USE']);
    const overview = (await keeper.get('/warehouse/overview').expect(200)).body;
    expect(overview.atPartners).toEqual([expect.objectContaining({ name: 'Mê Linh', inUse: 2 })]);
    // a batch is all or nothing
    expect((await keeper.post('/warehouse/batches', { kind: 'OUT', date: today, partnerId: mlId, dieIds: [dieId] }).expect(409)).body.code).toBe('WH_DIE_ACTION_NOT_ALLOWED');
    const back = (await keeper.post('/warehouse/batches', { kind: 'IN', date: today, partnerId: mlId, dieIds: [dieId, die2Id] }).expect(201)).body;
    expect(back.dies.map((d: { status: string }) => d.status)).toEqual(['CHECKING', 'CHECKING']);
  });

  it('counts dies on a shelf and flags the missing ones', async () => {
    await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'PASS', date: today, locationId: shelfId }).expect(201);
    await keeper.post(`/warehouse/dies/${die2Id}/actions`, { action: 'PASS', date: today, locationId: shelfId }).expect(201);
    const c = (await keeper.post('/warehouse/die-counts', { locationId: shelfId }).expect(201)).body;
    expect(c.lines).toHaveLength(2);
    await keeper.post(`/warehouse/die-counts/${c.id}/marks`, { die: 'tui-001', found: true }).expect(201);
    const done = (await keeper.post(`/warehouse/die-counts/${c.id}/finish`).expect(201)).body;
    expect(done.lines.map((l: { code: string; found: boolean }) => [l.code, l.found])).toEqual([['TUI-001', true], ['TUI-002', false]]);
    const review = (await keeper.get('/warehouse/dies?flag=review').expect(200)).body.items;
    expect(review.map((d: { code: string }) => d.code)).toEqual(['TUI-002']);
    const d = (await keeper.put(`/warehouse/dies/${die2Id}`, { productName: 'Túi khác', lengthCm: 21.3, widthCm: 30, heightCm: 10, reviewed: true }).expect(200)).body;
    expect(d.needsReview).toBe(false);
  });
  it('imports the Excel die list: preview first, then write; running it again adds nothing', async () => {
    await t.prisma.$executeRawUnsafe('TRUNCATE "WhDieCountLine", "WhDieCount", "WhDieMove", "WhDieBatch", "WhDie" CASCADE');
    await t.prisma.$executeRawUnsafe('UPDATE "WhDieSymbol" SET "lastNo" = 0');
    const agent = request.agent(t.app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ username: ADMIN, password: PASSWORD }).expect(200);
    const file = readFileSync(join(__dirname, 'fixtures', 'khuon-mau.xlsx'));
    const upload = (dryRun: boolean) => agent.post(`/api/v1/warehouse/dies/import?dryRun=${dryRun}`).attach('file', file, 'khuon.xlsx');

    const preview = (await upload(true).expect(201)).body;
    expect(preview).toMatchObject({ dryRun: true, dies: 5, skippedExisting: 0, history: 1, partnersCreated: [], locationsCreated: ['Tầng 4'], byStatus: { READY: 4, IN_USE: 1 } });
    const messages = preview.issues.map((i: { code: string | null; message: string }) => `${i.code}: ${i.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/^TUI-001: Cần xác nhận: Cùng kích thước với TUI-002/),
      expect.stringMatching(/^TEM-001: Kích thước "38 cm"/),
      expect.stringMatching(/^TEM-001: Cần xác nhận: Nơi ra khuôn "Khoa nhật minh" chưa rõ/),
      expect.stringMatching(/^HOP-001: Cần xác nhận: Trạng thái Excel: "CHƯA XÁC NHẬN".*Không có dòng TẠO KHUÔN/),
      expect.stringMatching(/^SAI MA: Mã khuôn không đúng dạng/),
      expect.stringMatching(/^null: Dòng XUẤT SẢN XUẤT không có mã khuôn/),
    ]));
    expect(await t.prisma.whDie.count({ where: { code: { in: ['TUI-007', 'TEM-001'] } } })).toBe(0);

    const done = (await upload(false).expect(201)).body;
    expect(done).toMatchObject({ dryRun: false, dies: 5 });
    const list = (await keeper.get('/warehouse/dies?q=co khi').expect(200)).body.items;
    expect(list).toEqual([expect.objectContaining({ code: 'TUI-007', status: 'IN_USE', place: 'Mê Linh', expectedBackOn: '2026-12-01', size: '41 x 41 x 24', orientation: 'LANDSCAPE' })]);
    const d = (await keeper.get(`/warehouse/dies/${list[0].id}`).expect(200)).body;
    expect(d.moves.map((m: { action: string; note: string }) => m.note)).toEqual(expect.arrayContaining([expect.stringMatching(/NHAP_LIEU dòng \d+: Xuất khuôn · nơi bế Mê Linh · hẹn lấy 2026-12-01/)]));
    const tui1 = (await keeper.get('/warehouse/dies?q=TUI-001').expect(200)).body.items[0];
    expect(tui1).toMatchObject({ place: 'Kho · Tầng 4', pieces: 2, orientation: 'PORTRAIT', needsReview: true });

    // codes continue after the highest number already used
    const next = (await keeper.post('/warehouse/dies', { symbolCode: 'TUI', productName: 'Túi mới', lengthCm: 50, widthCm: 50 }).expect(201)).body;
    expect(next.code).toBe('TUI-008');

    const again = (await upload(false).expect(201)).body;
    expect(again).toMatchObject({ dies: 0, skippedExisting: 5 });
  });
});
