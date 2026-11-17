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
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
    const role = await t.prisma.role.create({ data: { name: 'Thủ kho', permissions: normalizePermissions(['warehouse.slip', 'warehouse.dies', 'warehouse.count']) } });
    await t.prisma.user.create({ data: { username: 'kho', fullName: 'Hà Thủ kho', roleId: role.id, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false } });
    keeper = await t.login('kho');
    staff = await t.login('staff');
  });
  afterAll(() => t.app.close());

  let paperId: string;
  let item18: string;
  let item27: string;
  let glueItem: string;

  it('keeps materials with sizes; the same size cannot be listed twice', async () => {
    expect((await staff.get('/warehouse/materials').expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect((await keeper.post('/warehouse/materials', { group: 'Giấy', name: 'IC 145', unit: 'tờ', hasSizes: true, sizes: [] }).expect(403)).body.code).toBe('PERMISSION_DENIED');

    const dup = await t.api.post('/warehouse/materials', { group: 'Giấy', name: 'Giấy ngoại IC 145', unit: 'tờ', hasSizes: true, sizes: [{ widthCm: 18, lengthCm: 50.5 }, { widthCm: 18, lengthCm: 50.5 }] }).expect(400);
    expect(dup.body.code).toBe('WH_SIZE_DUPLICATE');
    await t.api.post('/warehouse/materials', { group: 'Giấy', name: 'Giấy ngoại IC 145', unit: 'tờ', hasSizes: true, sizes: [{ widthCm: 18, lengthCm: 50.5, minQty: 100 }, { widthCm: 27, lengthCm: 23 }] }).expect(204);
    await t.api.post('/warehouse/materials', { group: 'Keo', name: 'Keo sữa', unit: 'kg', hasSizes: false, sizes: [] }).expect(204);
    expect((await t.api.post('/warehouse/materials', { group: 'Keo', name: 'Keo sữa', unit: 'kg', hasSizes: false, sizes: [] }).expect(409)).body.code).toBe('WH_MATERIAL_EXISTS');

    const mats = (await keeper.get('/warehouse/materials').expect(200)).body;
    const paper = mats.find((m: { name: string }) => m.name === 'Giấy ngoại IC 145');
    paperId = paper.id;
    expect(paper.items.map((i: { label: string }) => i.label)).toEqual(['Giấy ngoại IC 145 · 18 x 50,5', 'Giấy ngoại IC 145 · 27 x 23']);
    item18 = paper.items[0].id;
    item27 = paper.items[1].id;
    glueItem = mats.find((m: { name: string }) => m.name === 'Keo sữa').items[0].id;
    expect(paper.items[0]).toMatchObject({ qty: 0, minQty: 100, low: true });
  });

  let receiptId: string;

  it('receives, issues and returns; stock never goes below zero', async () => {
    const r = (await keeper.post('/warehouse/slips', { kind: 'RECEIPT', date: today, reference: 'HĐ 123', lines: [{ stockItemId: item18, qty: 500, unitPriceVnd: 1200 }, { stockItemId: glueItem, qty: 12.5 }] }).expect(201)).body;
    expect(r.code).toMatch(/^NK\d{4}-\d{3,}$|^NK/);
    receiptId = r.id;

    const short = await keeper.post('/warehouse/slips', { kind: 'ISSUE', date: today, receiver: 'Xưởng in', lines: [{ stockItemId: item18, qty: 600 }] }).expect(400);
    expect(short.body.code).toBe('WH_STOCK_SHORT');
    expect((await keeper.post('/warehouse/slips', { kind: 'ISSUE', date: today, lines: [{ stockItemId: item18, qty: 1 }] }).expect(400)).body.code).toBe('WH_RECEIVER_REQUIRED');

    await keeper.post('/warehouse/slips', { kind: 'ISSUE', date: today, receiver: 'Anh Tuấn', purpose: 'In túi', reference: 'LSX 88', lines: [{ stockItemId: item18, qty: 320 }] }).expect(201);
    await keeper.post('/warehouse/slips', { kind: 'RETURN', date: today, receiver: 'Anh Tuấn', lines: [{ stockItemId: item18, qty: 20 }] }).expect(201);

    const stock = (await keeper.get('/warehouse/stock').expect(200)).body;
    const row = stock.find((i: { id: string }) => i.id === item18);
    expect(row).toMatchObject({ qty: 200, low: false });
    expect(row).not.toHaveProperty('valueVnd'); // money is hidden without money.view
    expect((await t.api.get('/warehouse/stock').expect(200)).body.find((i: { id: string }) => i.id === item18).valueVnd).toBe(240000);
    expect(stock.find((i: { id: string }) => i.id === glueItem).qty).toBe(12.5);

    const card = (await keeper.get(`/warehouse/stock/${item18}/card`).expect(200)).body;
    expect(card.rows.map((x: { inQty: number; outQty: number; balance: number }) => [x.inQty, x.outQty, x.balance])).toEqual([
      [20, 0, 200],
      [0, 320, 180],
      [500, 0, 500],
    ]);

    // void the receipt would push stock negative
    expect((await keeper.post(`/warehouse/slips/${receiptId}/void`, { reason: 'nhập nhầm' }).expect(400)).body.code).toBe('WH_VOID_NEGATIVE');
  });

  it('a size that has slips cannot be changed', async () => {
    const res = await t.api.put(`/warehouse/materials/${paperId}`, { group: 'Giấy', name: 'Giấy ngoại IC 145', unit: 'tờ', hasSizes: true, sizes: [{ id: item18, widthCm: 19, lengthCm: 50.5 }] }).expect(409);
    expect(res.body.code).toBe('WH_SIZE_IN_USE');
  });

  it('counts stock and approves the difference as an adjustment', async () => {
    const c = (await keeper.post('/warehouse/counts', { date: today, groups: ['Giấy'] }).expect(201)).body;
    expect(c.lines.map((l: { stockItemId: string }) => l.stockItemId).sort()).toEqual([item18, item27].sort());
    expect((await keeper.post('/warehouse/counts', { date: today }).expect(409)).body.code).toBe('WH_COUNT_OPEN');
    await keeper.put(`/warehouse/counts/${c.id}`, { entries: [{ stockItemId: item18, countedQty: 195 }, { stockItemId: item27, countedQty: 40 }] }).expect(200);
    await keeper.post(`/warehouse/counts/${c.id}/approve`).expect(403);
    const done = (await t.api.post(`/warehouse/counts/${c.id}/approve`).expect(201)).body;
    expect(done.status).toBe('APPROVED');
    expect(done.adjustSlipCode).toMatch(/^DC/);
    const stock = (await keeper.get('/warehouse/stock').expect(200)).body;
    expect(stock.find((i: { id: string }) => i.id === item18).qty).toBe(195);
    expect(stock.find((i: { id: string }) => i.id === item27).qty).toBe(40);
  });

  it('locks a month: no slips dated in it', async () => {
    const month = today.slice(0, 7);
    await t.api.post('/warehouse/month-locks', { month }).expect(204);
    expect((await keeper.post('/warehouse/slips', { kind: 'RECEIPT', date: today, lines: [{ stockItemId: item27, qty: 1 }] }).expect(400)).body.code).toBe('WH_MONTH_LOCKED');
    await t.api.delete(`/warehouse/month-locks/${month}`).expect(204);
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
