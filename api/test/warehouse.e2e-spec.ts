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
    const role = await t.prisma.role.create({ data: { name: 'Thủ kho', permissions: normalizePermissions(['warehouse.slip', 'warehouse.dies']) } });
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
    expect(list.map((w: { code: string }) => w.code)).toEqual(['GIAY', 'BAT', 'OFFSET', 'KHUON', 'XUANDINH']);
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

  it('reports in – out – balance, stock as of a day, and saves end-of-day snapshots', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    // a slip dated yesterday, so a snapshot of yesterday has something in it
    await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: yesterday, confirm: true, lines: [{ specId: spec27, qty: 10 }] }).expect(201);
    const rep = (await keeper.get(`/warehouse/reports/stock?warehouseId=${giay.id}&from=${today}&to=${today}`).expect(200)).body;
    const r18 = rep.rows.find((r: { specId: string }) => r.specId === spec18);
    // today: +500 receipt, −320 issue, +20 return, −50 transfer
    expect(r18).toMatchObject({ opening: 0, inQty: 520, outQty: 370, closing: 150 });
    expect(rep.rows.find((r: { specId: string }) => r.specId === spec27)).toMatchObject({ opening: 10, closing: 10 });

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

  let mlId: string;
  let kienId: string;
  let shelfId: string;
  let khuon: string;
  let xd: string;
  let dieId: string;
  let die2Id: string;
  const dieOf = async (api: Api, id: string) => (await api.get(`/warehouse/dies/${id}`).expect(200)).body;

  it('creates dies at the maker: maker required, codes are fixed, near-duplicates warn, size search ignores order', async () => {
    const list = (await t.api.get('/warehouse/warehouses').expect(200)).body;
    khuon = list.find((w: { code: string }) => w.code === 'KHUON').id;
    xd = list.find((w: { code: string }) => w.code === 'XUANDINH').id;
    const ha = await t.prisma.user.findFirstOrThrow({ where: { username: 'kho' } });
    await t.api.put(`/warehouse/warehouses/${khuon}`, { code: 'KHUON', name: 'Kho khuôn Âu Việt', keeperIds: [ha.id] }).expect(204);
    await t.api.post('/warehouse/partners', { name: 'Mê Linh', kind: 'DIE_SHOP' }).expect(204);
    await t.api.post('/warehouse/partners', { name: 'A.Kiên Trương Định', kind: 'DIE_SHOP' }).expect(204);
    await t.api.post('/warehouse/partners', { name: 'Em Hòa', kind: 'DIE_MAKER' }).expect(204);
    expect((await t.api.post('/warehouse/locations', { code: 'T4-K01', warehouseId: giay.id }).expect(400)).body.code).toBe('WH_WAREHOUSE_NOT_DIE');
    await t.api.post('/warehouse/locations', { code: 'T4-K01', warehouseId: khuon }).expect(204);
    const partners = (await keeper.get('/warehouse/partners').expect(200)).body;
    mlId = partners.find((p: { name: string }) => p.name === 'Mê Linh').id;
    kienId = partners.find((p: { name: string }) => p.name === 'A.Kiên Trương Định').id;
    const hoaId = partners.find((p: { name: string }) => p.name === 'Em Hòa').id;
    shelfId = (await keeper.get('/warehouse/locations').expect(200)).body[0].id;

    const base = { symbolCode: 'TUI', productName: 'Túi giấy Orien', lengthCm: 21, widthCm: 30, heightCm: 10 };
    expect((await keeper.post('/warehouse/dies', base).expect(400)).body.code).toBe('WH_DIE_MAKER_REQUIRED');
    // tạo khuôn mới: ở nơi làm khuôn, đang làm khuôn
    const a = (await requester.post('/warehouse/dies', { ...base, makerId: hoaId }).expect(201)).body;
    expect(a).toMatchObject({ code: 'TUI-001', status: 'MAKING', place: 'Em Hòa', size: '21 x 30 x 10', pendingBatchId: null, makerName: 'Em Hòa', allowedActions: ['PASS', 'DEFECT'] });
    dieId = a.id;
    // chưa kiểm đạt thì chưa bế được
    expect((await requester.post('/warehouse/batches', { date: today, fromPartnerId: hoaId, toPartnerId: mlId, dieIds: [dieId] }).expect(409)).body.code).toBe('WH_DIE_NOT_PASSED');
    // kiểm tra: không đạt → làm lại → kiểm tra lại: đạt (tại nơi làm khuôn, không cần chọn kệ)
    await requester.post(`/warehouse/dies/${dieId}/actions`, { action: 'DEFECT', date: today, note: 'Lệch dao' }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'DEFECT', place: 'Em Hòa' });
    await requester.post(`/warehouse/dies/${dieId}/actions`, { action: 'PASS', date: today }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'READY', place: 'Em Hòa' });
    // bế khuôn: thẳng từ nơi làm khuôn tới xưởng bế
    const go = (await requester.post('/warehouse/batches', { date: today, fromPartnerId: hoaId, toPartnerId: mlId, dieIds: [dieId], reference: 'LSX 1' }).expect(201)).body;
    expect(go).toMatchObject({ status: 'DONE', fromName: 'Em Hòa', toName: 'Mê Linh', reference: 'LSX 1' });
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'IN_USE', place: 'Mê Linh' });
    const moves = (await dieOf(keeper, dieId)).moves.map((m: { action: string }) => m.action);
    expect(moves).toEqual(['TRANSFER', 'PASS', 'DEFECT', 'CREATE']);

    const near = await keeper.post('/warehouse/dies', { ...base, productName: 'Túi khác', lengthCm: 21.3, makerId: hoaId }).expect(409);
    expect(near.body.code).toBe('WH_DIE_SIMILAR_EXISTS');
    expect(near.body.details.similar[0].code).toBe('TUI-001');
    const b = (await requester.post('/warehouse/dies', { ...base, productName: 'Túi khác', lengthCm: 21.3, makerId: hoaId, force: true }).expect(201)).body;
    expect(b).toMatchObject({ code: 'TUI-002', status: 'MAKING', place: 'Em Hòa' });
    die2Id = b.id;
    await requester.post(`/warehouse/dies/${die2Id}/actions`, { action: 'PASS', date: today }).expect(201);
    // chuyển kho: nơi làm khuôn → kho, kèm kệ
    await requester.post('/warehouse/batches', { date: today, fromPartnerId: hoaId, toWarehouseId: khuon, toLocationId: shelfId, dieIds: [die2Id] }).expect(201);
    expect(await dieOf(keeper, die2Id)).toMatchObject({ status: 'READY', place: 'Kho khuôn Âu Việt · T4-K01' });

    expect((await keeper.get('/warehouse/dies?q=30x10x21').expect(200)).body.items.map((d: { code: string }) => d.code)).toEqual(['TUI-001', 'TUI-002']);
    expect((await keeper.get('/warehouse/dies?q=30x10x22').expect(200)).body.items).toEqual([]);
    expect((await keeper.get('/warehouse/dies?q=orien').expect(200)).body.items.map((d: { code: string }) => d.code)).toEqual(['TUI-001']);
    expect((await keeper.get(`/warehouse/dies?place=k:${khuon}`).expect(200)).body.total).toBe(1);
    expect((await keeper.get(`/warehouse/dies?place=x:${mlId}`).expect(200)).body.total).toBe(1);
  });

  it('cuts and moves dies at once: bế khuôn to a workshop, chuyển kho between khos; no confirmation step', async () => {
    expect((await keeper.post(`/warehouse/dies/${dieId}/actions`, { action: 'KEEP', date: today }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    // the die must be where the transfer starts
    expect((await requester.post('/warehouse/batches', { date: today, fromWarehouseId: khuon, toPartnerId: kienId, dieIds: [dieId] }).expect(409)).body.code).toBe('WH_DIE_NOT_HERE');
    // bế ở xưởng khác: xưởng → xưởng thẳng
    await requester.post('/warehouse/batches', { date: today, fromPartnerId: mlId, toPartnerId: kienId, dieIds: [dieId], reference: 'LSX 2' }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'IN_USE', place: 'A.Kiên Trương Định' });
    // bế xong về kho: sẵn sàng
    await requester.post('/warehouse/batches', { date: today, fromPartnerId: kienId, toWarehouseId: xd, dieIds: [dieId] }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'READY', place: 'Kho Xuân Đỉnh', warehouseName: 'Kho Xuân Đỉnh', holderId: null });
    // chuyển kho A → B giữ nguyên trạng thái
    await requester.post('/warehouse/batches', { date: today, fromWarehouseId: xd, toWarehouseId: khuon, toLocationId: shelfId, dieIds: [dieId] }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'READY', place: 'Kho khuôn Âu Việt · T4-K01' });
    // kho → xưởng bế
    const out = (await requester.post('/warehouse/batches', { date: today, fromWarehouseId: khuon, toPartnerId: mlId, dieIds: [dieId], reference: 'LSX 88' }).expect(201)).body;
    expect(out).toMatchObject({ code: expect.stringMatching(/^GN/), status: 'DONE', fromName: 'Kho khuôn Âu Việt', toName: 'Mê Linh', canSend: false, canReceive: false });
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'IN_USE', place: 'Mê Linh', overdue: false });
    // báo lỗi ở xưởng, gửi về nơi làm khuôn sửa, kiểm tra đạt, bế tiếp
    await requester.post(`/warehouse/dies/${dieId}/actions`, { action: 'DEFECT', date: today, note: 'Mẻ dao' }).expect(201);
    expect((await requester.post('/warehouse/batches', { date: today, fromPartnerId: mlId, toPartnerId: kienId, dieIds: [dieId] }).expect(409)).body.code).toBe('WH_DIE_NOT_PASSED');
    const hoa = (await keeper.get('/warehouse/partners').expect(200)).body.find((p: { name: string }) => p.name === 'Em Hòa').id;
    await requester.post('/warehouse/batches', { date: today, fromPartnerId: mlId, toPartnerId: hoa, dieIds: [dieId] }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'REPAIRING', place: 'Em Hòa' });
    await requester.post(`/warehouse/dies/${dieId}/actions`, { action: 'PASS', date: today }).expect(201);
    await requester.post('/warehouse/batches', { date: today, fromPartnerId: hoa, toPartnerId: mlId, dieIds: [dieId] }).expect(201);
    expect(await dieOf(keeper, dieId)).toMatchObject({ status: 'IN_USE', place: 'Mê Linh' });

    // khuôn có sẵn trong kho nhưng chưa có mã: cấp mã khi chuyển
    const nw = (await keeper.post('/warehouse/batches', { date: today, fromWarehouseId: khuon, toPartnerId: mlId, dieIds: [], newDies: [{ symbolCode: 'HOP', productName: 'Hộp trà sen', size: '12x12x8' }], reference: 'LSX 5' }).expect(201)).body;
    expect(nw.dies).toEqual([expect.objectContaining({ code: 'HOP-001', status: 'IN_USE', place: 'Mê Linh', size: '12 x 12 x 8', needsReview: true })]);

    // nhật ký theo ngày, lọc theo nơi và thao tác
    const j = (await keeper.get(`/warehouse/die-journal?from=${today}&to=${today}&place=Mê Linh&action=TRANSFER`).expect(200)).body;
    expect(j.map((r: { code: string; fromPlace: string; place: string }) => `${r.code} ${r.fromPlace} → ${r.place}`)).toEqual([
      'TUI-001 Em Hòa → Mê Linh',
      'TUI-001 Mê Linh → A.Kiên Trương Định',
      'TUI-001 Kho khuôn Âu Việt · T4-K01 → Mê Linh',
      'TUI-001 Mê Linh → Em Hòa',
      'TUI-001 Em Hòa → Mê Linh',
      'HOP-001 Kho khuôn Âu Việt → Mê Linh',
    ]);
    // lọc các lần chuyển theo nơi đi hoặc đến
    const atKien = (await keeper.get(`/warehouse/batches?tab=all&place=x:${kienId}`).expect(200)).body;
    expect(atKien.map((b: { fromName: string; toName: string }) => `${b.fromName} → ${b.toName}`).sort()).toEqual(['A.Kiên Trương Định → Kho Xuân Đỉnh', 'Mê Linh → A.Kiên Trương Định']);
    expect((await keeper.get(`/warehouse/batches?tab=all&place=k:${xd}`).expect(200)).body).toHaveLength(2);
    const ov = (await keeper.get('/warehouse/overview').expect(200)).body;
    expect(ov.dieToConfirm).toEqual([]);
    expect(ov.diePlaces.find((p: { name: string }) => p.name === 'Mê Linh').dies).toBe(2);
  });

  it('dies coded on a transfer are flagged until someone confirms their details', async () => {
    const review = (await keeper.get('/warehouse/dies?flag=review').expect(200)).body.items;
    expect(review.map((d: { code: string }) => d.code)).toEqual(['HOP-001']);
    const d = (await keeper.put(`/warehouse/dies/${review[0].id}`, { productName: 'Hộp trà sen', lengthCm: 12, widthCm: 12, heightCm: 8, reviewed: true }).expect(200)).body;
    expect(d.needsReview).toBe(false);
  });

  it('a name typed in a catalog picker is added to the catalog (no catalog permission needed) and reused after', async () => {
    const r1 = (await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: today, partnerName: '  giấy   Hà Nội ', lines: [{ specId: spec18, qty: 1 }] }).expect(201)).body;
    const r2 = (await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: today, partnerName: 'GIẤY HÀ NỘI', lines: [{ specId: spec18, qty: 1 }] }).expect(201)).body;
    expect(r1.partnerName).toBe('giấy Hà Nội');
    expect(r2.partnerId).toBe(r1.partnerId);
    expect(await t.prisma.whPartner.findUniqueOrThrow({ where: { id: r1.partnerId }, select: { kind: true } })).toEqual({ kind: 'SUPPLIER' });
    // an id wins over a typed name; issue slips have no "nơi lấy hàng"
    const r3 = (await keeper.post('/warehouse/slips', { warehouseId: giay.id, kind: 'RECEIPT', date: today, partnerId: mlId, partnerName: 'bỏ qua', lines: [{ specId: spec18, qty: 1 }] }).expect(201)).body;
    expect(r3.partnerId).toBe(mlId);
    expect(await t.prisma.whPartner.count({ where: { name: 'bỏ qua' } })).toBe(0);
    for (const s of [r1, r2, r3]) await keeper.post(`/warehouse/slips/${s.id}/cancel`, {}).expect(201);

    // nơi làm khuôn gõ tên mới; chuyển tới xưởng gõ tên mới; cất ở kệ gõ mã mới
    const base = { symbolCode: 'HOP', productName: 'Hộp bánh thử danh mục', lengthCm: 51, widthCm: 41, heightCm: 6 };
    const made = (await keeper.post('/warehouse/dies', { ...base, makerName: 'Nơi làm khuôn Mới' }).expect(201)).body;
    expect(made).toMatchObject({ makerName: 'Nơi làm khuôn Mới', place: 'Nơi làm khuôn Mới', status: 'MAKING' });
    expect(await t.prisma.whPartner.findFirstOrThrow({ where: { name: 'Nơi làm khuôn Mới' }, select: { kind: true } })).toEqual({ kind: 'DIE_MAKER' });
    await keeper.post(`/warehouse/dies/${made.id}/actions`, { action: 'PASS', date: today }).expect(201);
    await keeper.post('/warehouse/batches', { date: today, fromPartnerId: made.makerId, toPartnerName: 'Xưởng bế Mới', dieIds: [made.id] }).expect(201);
    const shop = await t.prisma.whPartner.findFirstOrThrow({ where: { name: 'Xưởng bế Mới' } });
    expect(shop.kind).toBe('DIE_SHOP');
    expect((await dieOf(keeper, made.id)).place).toBe('Xưởng bế Mới');
    const second = (await keeper.post('/warehouse/dies', { ...base, productName: 'Hộp bánh thử kệ', lengthCm: 80, makerName: 'nơi làm khuôn mới' }).expect(201)).body;
    expect(second.makerId).toBe(made.makerId);
    await keeper.post('/warehouse/batches', { date: today, fromPartnerId: made.makerId, toWarehouseId: khuon, toLocationCode: 'T9-K99', dieIds: [second.id] }).expect(201);
    expect((await dieOf(keeper, second.id)).place).toBe('Kho khuôn Âu Việt · T9-K99');
    expect(await t.prisma.whLocation.count({ where: { warehouseId: khuon, code: 'T9-K99' } })).toBe(1);
  });

  it('imports the paper stock sheet: catalog plus a slip that brings stock to the sheet, re-imports replace or top up', async () => {
    const agent = request.agent(t.app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ username: ADMIN, password: PASSWORD }).expect(200);
    const file = readFileSync(join(__dirname, 'fixtures', 'giay-mau.xlsx'));
    const upload = (dryRun: boolean) => agent.post(`/api/v1/warehouse/materials/import-paper?dryRun=${dryRun}`).attach('file', file, 'giay.xlsx');
    const preview = (await upload(true).expect(201)).body;
    expect(preview).toMatchObject({ sheet: 'Tồn giấy(Mới kiểm kê)', rows: 8, materialsCreated: 6, specsCreated: 8, counted: 7, adjusted: 7, unchanged: 0, replacedSlips: [], slipCode: null, totalQty: 1753 });
    expect(preview.items.map((i: { code: string; group: string; name: string; size: string; qty: number | null }) => `${i.code}|${i.group}|${i.name}|${i.size}|${i.qty}`)).toEqual(expect.arrayContaining([
      'DC|Đề can|Đề can giấy đế trắng LH|21,5 x 31,5|255',
      'C150|Couche|C150|42 x 50|575',
      'GN|Giấy ngoại|Recycle Black card 300gsm-đen|78,7 x 109,2|62',
      'Ivory|Ivory|Ivory400|22,8 x 39,5|null',
    ]));
    expect(preview.issues.map((i: { message: string }) => i.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^Khổ "khổ to"/), expect.stringMatching(/^Chưa có số tồn \(chưa đếm\)/)]));
    expect(await t.prisma.whMaterial.count({ where: { name: 'C150' } })).toBe(0);

    // materials made by earlier versions (no code, or group = Mã VT) are reused; code becomes the sheet's Mã VT
    await t.prisma.whMaterial.create({ data: { group: 'Couche', name: 'C150', unit: 'tờ', hasSizes: true } });
    await t.prisma.whMaterial.create({ data: { group: 'DC', name: 'Đề can giấy đế trắng LH', unit: 'tờ', hasSizes: true } });
    const done = (await upload(false).expect(201)).body;
    expect(done.slipCode).toMatch(/^DC-GIAY-/);
    expect(await t.prisma.whMaterial.findMany({ where: { name: 'C150' }, select: { code: true, group: true } })).toEqual([{ code: 'C150', group: 'Couche' }]);
    expect(await t.prisma.whMaterial.findMany({ where: { name: 'Đề can giấy đế trắng LH' }, select: { code: true, group: true } })).toEqual([{ code: 'DC', group: 'Đề can' }]);
    expect(await t.prisma.whMaterial.findFirst({ where: { name: 'Op140' }, select: { code: true, group: true } })).toEqual({ code: 'Op', group: 'Op' });
    const slip = (await agent.get(`/api/v1/warehouse/slips?warehouseId=${giay.id}`).expect(200)).body.find((x: { code: string }) => x.code === done.slipCode);
    expect(slip).toMatchObject({ kind: 'ADJUST', status: 'PENDING', purpose: 'Tồn đầu' });
    expect(slip.lines.filter((l: { label: string }) => l.label.startsWith('Op140')).map((l: { qty: number }) => l.qty).sort((a: number, b: number) => a - b)).toEqual([75, 250]);
    // importing again while it waits replaces it with a fresh slip
    const second = (await upload(false).expect(201)).body;
    expect(second).toMatchObject({ materialsCreated: 0, specsCreated: 0, adjusted: 7, replacedSlips: [done.slipCode] });
    expect(second.slipCode).not.toBe(done.slipCode);
    const slips = (await agent.get(`/api/v1/warehouse/slips?warehouseId=${giay.id}`).expect(200)).body;
    expect(slips.find((x: { code: string }) => x.code === done.slipCode).status).toBe('CANCELLED');
    const fresh = slips.find((x: { code: string }) => x.code === second.slipCode);
    await agent.post(`/api/v1/warehouse/slips/${fresh.id}/confirm`).expect(201);
    const stockOf = async (label: string) => (await agent.get(`/api/v1/warehouse/stock?warehouseId=${giay.id}`).expect(200)).body.find((s: { label: string }) => s.label === label).qty;
    expect(await stockOf('C150 · 42 x 50')).toBe(575);

    // stock matches the sheet: nothing to write
    expect((await upload(false).expect(201)).body).toMatchObject({ adjusted: 0, unchanged: 7, replacedSlips: [], slipCode: null });
    // stock drifted after confirmation: the new slip only carries the difference
    const st = await t.prisma.whStock.findFirstOrThrow({ where: { warehouseId: giay.id, spec: { material: { name: 'C150' }, widthCm: 42, lengthCm: 50 } } });
    await t.prisma.whStock.update({ where: { id: st.id }, data: { qty: 500 } });
    const topUp = (await upload(false).expect(201)).body;
    expect(topUp).toMatchObject({ adjusted: 1, unchanged: 6 });
    expect(topUp.items.find((i: { name: string; size: string }) => i.name === 'C150' && i.size === '42 x 50')).toMatchObject({ onHand: 500, qty: 575, delta: 75 });
    const fix = (await agent.get(`/api/v1/warehouse/slips?warehouseId=${giay.id}`).expect(200)).body.find((x: { code: string }) => x.code === topUp.slipCode);
    expect(fix).toMatchObject({ purpose: 'Điều chỉnh theo bảng tồn giấy' });
    expect(fix.lines.map((l: { qty: number }) => l.qty)).toEqual([75]);
    await agent.post(`/api/v1/warehouse/slips/${fix.id}/confirm`).expect(201);
    expect(await stockOf('C150 · 42 x 50')).toBe(575);
  });

  it('imports the Excel die list: preview first, then write; running it again adds nothing', async () => {
    await t.prisma.$executeRawUnsafe('TRUNCATE "WhDieCountLine", "WhDieCount", "WhDieMove", "WhDieBatchItem", "WhDieBatch", "WhDie" CASCADE');
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
    expect(list).toEqual([expect.objectContaining({ code: 'TUI-007', status: 'IN_USE', place: 'Mê Linh', expectedBackOn: null, size: '41 x 41 x 24', orientation: 'LANDSCAPE' })]);
    const d = (await keeper.get(`/warehouse/dies/${list[0].id}`).expect(200)).body;
    expect(d.moves.map((m: { action: string; note: string }) => m.note)).toEqual(expect.arrayContaining([expect.stringMatching(/NHAP_LIEU dòng \d+: Xuất khuôn · nơi bế Mê Linh · hẹn lấy 2026-12-01/)]));
    const tui1 = (await keeper.get('/warehouse/dies?q=TUI-001').expect(200)).body.items[0];
    expect(tui1).toMatchObject({ place: 'Kho khuôn Âu Việt · Tầng 4', pieces: 2, orientation: 'PORTRAIT', needsReview: true });

    // codes continue after the highest number already used
    const next = (await keeper.post('/warehouse/dies', { symbolCode: 'TUI', productName: 'Túi mới', lengthCm: 50, widthCm: 50, makerName: 'Em Hòa' }).expect(201)).body;
    expect(next.code).toBe('TUI-008');

    const again = (await upload(false).expect(201)).body;
    expect(again).toMatchObject({ dies: 0, skippedExisting: 5 });
  });
});
