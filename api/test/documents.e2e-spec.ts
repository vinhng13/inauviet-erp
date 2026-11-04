import type request from 'supertest';
import { unzipSync } from 'fflate';
import { createTestApp, PASSWORD, resetDatabase, type Api, type TestContext } from './helpers';

/** Collect the raw body (PDF / zip) instead of parsing it */
function binary(test: request.Test): request.Test {
  return test.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('documents (PDF and zip)', () => {
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
    customerId = (await t.api.post('/customers', { name: 'Anh Minh', companyName: 'Công ty ABC', phone: '0903123456' }).expect(201)).body.id;
  });

  async function account(name: string, permissions: string[]): Promise<Api> {
    const role = (await t.api.post('/roles', { name, permissions }).expect(201)).body;
    const username = name.toLowerCase().replace(/[^a-z]/g, '');
    await t.api.post('/accounts', { username, fullName: name, roleId: role.id, password: 'Tam-thoi-2026-ok' }).expect(201);
    const api = await t.login(username, 'Tam-thoi-2026-ok');
    await api.post('/auth/change-password', { currentPassword: 'Tam-thoi-2026-ok', newPassword: PASSWORD }).expect(204);
    return api;
  }

  it('renders each document, only once it exists, and zips them per order and per customer', async () => {
    const quote = (await t.api.post('/quotes', { customerId, title: 'Biển hiệu', lines: [{ description: 'Biển alu', unit: 'cái', quantity: 2, unitPriceVnd: 1_500_000 }] }).expect(201)).body;
    const lost = (await t.api.post('/quotes', { customerId, lines: [{ description: 'Tờ rơi', unit: 'tờ', quantity: 500, unitPriceVnd: 700 }] }).expect(201)).body;
    await t.api.post(`/quotes/${lost.id}/lose`, { reason: 'Giá cao' }).expect(200);
    const { orderId, orderCode } = (await t.api.post(`/quotes/${quote.id}/close`, {}).expect(200)).body;

    const q = await binary(t.api.get(`/documents/quote/${quote.id}`)).expect(200);
    expect(q.headers['content-type']).toBe('application/pdf');
    expect(q.headers['content-disposition']).toContain(`inline; filename="${quote.code}_BaoGia.pdf"`);
    expect((q.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const dl = await binary(t.api.get(`/documents/order/${orderId}?download=true`)).expect(200);
    expect(dl.headers['content-disposition']).toContain(`attachment; filename="${orderCode}_DonHang.pdf"`);
    await binary(t.api.get(`/documents/invoice/${orderId}`)).expect(200);
    expect((await t.api.get(`/documents/lsx/${orderId}`).expect(409)).body.code).toBe('DOCUMENT_NOT_AVAILABLE');
    expect((await t.api.get(`/documents/acceptance/${orderId}`).expect(409)).body.code).toBe('DOCUMENT_NOT_AVAILABLE');

    await t.api.post(`/orders/${orderId}/confirm`, { needsDesign: true }).expect(200);
    const order = (await t.api.post(`/orders/${orderId}/design/versions`, { note: 'Zalo' }).expect(201)).body;
    await binary(t.api.get(`/documents/design/${orderId}`)).expect(200);
    await t.api.post(`/orders/${orderId}/design/versions/${order.design.versions[0].id}/feedback`, { approved: true }).expect(200);
    await t.api.patch(`/orders/${orderId}/design/approval`, { finalized: true }).expect(200);
    const locked = (await t.api.post(`/orders/${orderId}/design/lock`).expect(200)).body;
    const lsx = await binary(t.api.get(`/documents/lsx/${orderId}`)).expect(200);
    expect(lsx.headers['content-disposition']).toContain(`${locked.production.code}_LenhSanXuat.pdf`);

    const zip = await binary(t.api.get(`/orders/${orderId}/documents/zip`)).expect(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(Object.keys(unzipSync(new Uint8Array(zip.body as Buffer))).sort()).toEqual(
      [`${quote.code}_BaoGia.pdf`, `${orderCode}_DonHang.pdf`, `TK-${orderCode.slice(3)}_DuyetThietKe.pdf`, `${locked.production.code}_LenhSanXuat.pdf`, `HD-${orderCode.slice(3)}_HoaDon.pdf`].sort(),
    );
    const some = await binary(t.api.get(`/orders/${orderId}/documents/zip?kinds=order,invoice`)).expect(200);
    expect(Object.keys(unzipSync(new Uint8Array(some.body as Buffer)))).toHaveLength(2);
    await t.api.get(`/orders/${orderId}/documents/zip?kinds=nope`).expect(400);

    const docs = (await t.api.get(`/customers/${customerId}/documents`).expect(200)).body;
    expect(docs.zipName).toMatch(/^KH-0001_AnhMinh_TaiLieu\.zip$/);
    expect(docs.rows).toHaveLength(2);
    const row = docs.rows.find((r: { orderId: string | null }) => r.orderId === orderId);
    expect(row.files.map((f: { kind: string }) => f.kind)).toEqual(['quote', 'order', 'design', 'lsx', 'invoice']);
    expect(docs.rows.find((r: { orderId: string | null }) => !r.orderId)).toMatchObject({ quoteCode: lost.code, quoteStatus: 'LOST', files: [{ kind: 'quote' }] });

    const all = await binary(t.api.get(`/customers/${customerId}/documents/zip?kinds=quote`)).expect(200);
    expect(all.headers['content-disposition']).toContain('KH-0001_AnhMinh_TaiLieu.zip');
    expect(Object.keys(unzipSync(new Uint8Array(all.body as Buffer))).sort()).toEqual([`${lost.code}/${lost.code}_BaoGia.pdf`, `${orderCode}/${quote.code}_BaoGia.pdf`].sort());
  });

  it('documents with prices need money.view', async () => {
    const o = (await t.api.post('/orders', { customerId, lines: [{ description: 'Banner', quantity: 1, unitPriceVnd: 500_000 }] }).expect(201)).body;
    await t.api.post(`/orders/${o.id}/confirm`, { needsDesign: false }).expect(200);
    const workshop = await account('Xuong', ['production.update']);
    await binary(workshop.get(`/documents/lsx/${o.id}`)).expect(200);
    expect((await workshop.get(`/documents/order/${o.id}`).expect(403)).body.code).toBe('PERMISSION_DENIED');
    await workshop.get(`/documents/invoice/${o.id}`).expect(403);
    await workshop.get(`/customers/${customerId}/documents`).expect(403);
  });
});
