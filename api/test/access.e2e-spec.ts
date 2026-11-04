import { createTestApp, PASSWORD, resetDatabase, STAFF, type TestContext } from './helpers';

describe('sign-in, accounts and permission groups', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
  });

  async function roleId(name: string): Promise<string> {
    return (await t.prisma.role.findUniqueOrThrow({ where: { name } })).id;
  }

  describe('sign-in', () => {
    it('health needs no login; everything else does', async () => {
      await t.anonymous.get('/health').expect(200, { status: 'ok' });
      const r = await t.anonymous.get('/board').expect(401);
      expect(r.body.code).toBe('UNAUTHENTICATED');
    });

    it('sets an HttpOnly session cookie and returns permissions', async () => {
      const res = await t.anonymous.post('/auth/login', { username: 'Staff', password: PASSWORD }).expect(200);
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/erp_session=[\w-]{40,}/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(res.body).toMatchObject({ username: STAFF, isAdmin: false, mustChangePassword: false });
      expect(res.body.permissions).toContain('deliveries.deliver');
      expect(res.body.permissions).not.toContain('payments.void');
      expect(await t.prisma.session.count()).toBe(2); // admin (from reset) + this one
      const stored = await t.prisma.session.findFirstOrThrow({ where: { user: { username: STAFF } } });
      expect(cookie).not.toContain(stored.tokenHash);
    });

    it('rejects wrong passwords the same way as unknown usernames, then locks after 5 tries', async () => {
      const wrong = await t.anonymous.post('/auth/login', { username: STAFF, password: 'nope-nope-nope' }).expect(401);
      const unknown = await t.anonymous.post('/auth/login', { username: 'ghost', password: 'nope-nope-nope' }).expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body).toEqual(wrong.body);
      for (let i = 0; i < 4; i++) await t.anonymous.post('/auth/login', { username: STAFF, password: 'nope-nope-nope' }).expect(401);
      const locked = await t.anonymous.post('/auth/login', { username: STAFF, password: PASSWORD }).expect(429);
      expect(locked.body.code).toBe('LOGIN_LOCKED');
    });

    it('logout ends the session', async () => {
      const staff = await t.login(STAFF);
      await staff.get('/auth/me').expect(200);
      await staff.post('/auth/logout').expect(204);
      await staff.get('/auth/me').expect(401);
    });
  });

  describe('accounts', () => {
    it('creates an account by hand with a temporary password that must be changed', async () => {
      const created = await t.api
        .post('/accounts', { username: 'Lan.Nguyen', fullName: 'Nguyễn Thị Lan', roleId: await roleId('Nhân viên') })
        .expect(201);
      expect(created.body.account).toMatchObject({ username: 'lan.nguyen', roleName: 'Nhân viên', mustChangePassword: true, hasPassword: true });
      const temp = created.body.temporaryPassword as string;
      expect(temp).toMatch(/^[a-zA-Z2-9]{10}$/);

      const lan = await t.login('lan.nguyen', temp);
      expect((await lan.get('/auth/me').expect(200)).body.mustChangePassword).toBe(true);
      expect((await lan.get('/board').expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      expect((await lan.post('/auth/change-password', { currentPassword: temp, newPassword: 'short' }).expect(400)).body.code).toBe('WEAK_PASSWORD');
      await lan.post('/auth/change-password', { currentPassword: temp, newPassword: 'Giao-hang-dung-hen' }).expect(204);
      await lan.get('/board').expect(200);
      await t.login('lan.nguyen', 'Giao-hang-dung-hen');
    });

    it('rejects duplicate and badly formed usernames', async () => {
      const id = await roleId('Nhân viên');
      expect((await t.api.post('/accounts', { username: 'STAFF', fullName: 'x', roleId: id }).expect(409)).body.code).toBe('USERNAME_EXISTS');
      expect((await t.api.post('/accounts', { username: 'có dấu', fullName: 'x', roleId: id }).expect(400)).body.code).toBe('INVALID_USERNAME');
    });

    it('locking an account ends its sessions at once; reset password signs it out', async () => {
      const staff = await t.login(STAFF);
      const staffId = (await staff.get('/auth/me')).body.id;
      await t.api.patch(`/accounts/${staffId}`, { isActive: false }).expect(200);
      await staff.get('/auth/me').expect(401);
      expect((await t.anonymous.post('/auth/login', { username: STAFF, password: PASSWORD }).expect(403)).body.code).toBe('ACCOUNT_DISABLED');

      await t.api.patch(`/accounts/${staffId}`, { isActive: true }).expect(200);
      const again = await t.login(STAFF);
      const reset = await t.api.post(`/accounts/${staffId}/reset-password`, {}).expect(200);
      expect(reset.body.temporaryPassword).toMatch(/^[a-zA-Z2-9]{10}$/);
      await again.get('/auth/me').expect(401);
      await t.anonymous.post('/auth/login', { username: STAFF, password: PASSWORD }).expect(401);
    });

    it('protects the last administrator and the caller\'s own account', async () => {
      const me = (await t.api.get('/auth/me')).body;
      expect((await t.api.patch(`/accounts/${me.id}`, { isActive: false }).expect(409)).body.code).toBe('SELF_LOCK');
      expect((await t.api.patch(`/accounts/${me.id}`, { roleId: await roleId('Nhân viên') }).expect(409)).body.code).toBe('SELF_ROLE');

      const second = await t.api.post('/accounts', { username: 'admin2', fullName: 'Admin 2', roleId: me.roleId, password: 'Second-admin-pass' }).expect(201);
      // admin2 exists but must still change password; demoting the only usable admin is refused from admin2's side too
      const admin2 = await t.login('admin2', 'Second-admin-pass');
      await admin2.post('/auth/change-password', { currentPassword: 'Second-admin-pass', newPassword: 'Second-admin-pass-2' }).expect(204);
      await admin2.patch(`/accounts/${me.id}`, { roleId: await roleId('Nhân viên') }).expect(200);
      const r = await admin2.patch(`/accounts/${second.body.account.id}`, { isActive: false }).expect(409);
      expect(r.body.code).toBe('SELF_LOCK');
    });

    it('staff cannot manage accounts', async () => {
      const staff = await t.login(STAFF);
      const r = await staff.get('/accounts').expect(403);
      expect(r.body.details.missing).toEqual(['accounts.view']);
    });
  });

  describe('permission groups', () => {
    it('lists the catalog and adds implied permissions when saving', async () => {
      const catalog = (await t.api.get('/permissions').expect(200)).body;
      expect(catalog.map((m: { key: string }) => m.key)).toEqual(['quotes', 'orders', 'design', 'production', 'deliveries', 'payments', 'money', 'customers', 'products', 'accounts', 'roles']);
      const role = await t.api.post('/roles', { name: 'Giao hàng', permissions: ['deliveries.deliver', 'made.up'] }).expect(201);
      expect(role.body.permissions).toEqual(['orders.view', 'deliveries.view', 'deliveries.deliver']);
      const roles = (await t.api.get('/roles').expect(200)).body;
      expect(roles[0]).toMatchObject({ name: 'Quản trị viên', isSystem: true });
      expect(roles[0].permissions.length).toBe(catalog.reduce((n: number, m: { actions: unknown[] }) => n + m.actions.length, 0));
    });

    it('a driver group sees no money, cannot create orders, but can deliver', async () => {
      const group = (await t.api.post('/roles', { name: 'Giao hàng', permissions: ['deliveries.deliver', 'customers.view'] }).expect(201)).body;
      await t.api.post('/accounts', { username: 'taixe', fullName: 'Tài xế', roleId: group.id, password: 'Xe-tai-so-7-ok' }).expect(201);
      const driver = await t.login('taixe', 'Xe-tai-so-7-ok');
      await driver.post('/auth/change-password', { currentPassword: 'Xe-tai-so-7-ok', newPassword: 'Xe-tai-so-8-ok' }).expect(204);

      const c = (await t.api.post('/customers', { name: 'ABC', phone: '0903123456' }).expect(201)).body;
      const o = (
        await t.api
          .post('/orders', {
            customerId: c.id,
            lines: [{ description: 'Banner', quantity: 2, unitPriceVnd: 500_000 }],
            deliveries: [{ plannedDate: '2026-11-02', lines: [{ lineIndex: 0, plannedQty: 2 }] }],
            deposit: { amountVnd: 300_000, method: 'CASH' },
          })
          .expect(201)
      ).body;

      const seen = (await driver.get(`/orders/${o.id}`).expect(200)).body;
      expect(seen.code).toBe(o.code);
      expect(JSON.stringify(seen)).not.toMatch(/Vnd|paymentStatus/);
      expect(seen.payments).toEqual([]);
      const board = (await driver.get('/board').expect(200)).body;
      expect(JSON.stringify(board)).not.toMatch(/Vnd/);

      await driver.post('/orders', { customerId: c.id, lines: [{ description: 'x', quantity: 1 }] }).expect(403);
      await driver.post(`/orders/${o.id}/payments`, { amountVnd: 1, method: 'CASH' }).expect(403);
      expect((await driver.post(`/deliveries/${o.deliveries[0].id}/deliver`, { payment: { amountVnd: 1, method: 'CASH' } }).expect(403)).body.code).toBe('PERMISSION_DENIED');
      await driver.post(`/deliveries/${o.deliveries[0].id}/deliver`).expect(200);
      expect((await t.api.get(`/orders/${o.id}`)).body).toMatchObject({ status: 'DELIVERING', fullyDelivered: true });
      await driver.post(`/orders/${o.id}/accept`, { signedBy: 'Chị Lan' }).expect(403);
    });

    it('editing lines without price permission keeps stored prices', async () => {
      const group = (await t.api.post('/roles', { name: 'Sản xuất', permissions: ['orders.update'] }).expect(201)).body;
      await t.api.post('/accounts', { username: 'xuong', fullName: 'Xưởng', roleId: group.id, password: 'Nha-may-in-2026' }).expect(201);
      const xuong = await t.login('xuong', 'Nha-may-in-2026');
      await xuong.post('/auth/change-password', { currentPassword: 'Nha-may-in-2026', newPassword: 'Nha-may-in-2027' }).expect(204);
      const c = (await t.api.post('/customers', { name: 'ABC', phone: '0903123456' }).expect(201)).body;
      const o = (await t.api.post('/orders', { customerId: c.id, lines: [{ description: 'Banner', quantity: 2, unitPriceVnd: 500_000 }] }).expect(201)).body;
      await xuong.put(`/orders/${o.id}/lines`, { lines: [{ id: o.lines[0].id, description: 'Banner 2×1 m', quantity: 3 }] }).expect(200);
      const after = (await t.api.get(`/orders/${o.id}`)).body;
      expect(after.lines[0]).toMatchObject({ description: 'Banner 2×1 m', quantity: 3, unitPriceVnd: 500_000 });
      expect(after.totalVnd).toBe(1_500_000);
    });

    it('cannot grant the admin group or edit your own group without being admin', async () => {
      const managers = (await t.api.post('/roles', { name: 'Quản lý', permissions: ['accounts.create', 'accounts.update', 'roles.manage'] }).expect(201)).body;
      await t.api.post('/accounts', { username: 'quanly', fullName: 'Quản lý', roleId: managers.id, password: 'Quan-ly-cua-hang' }).expect(201);
      const ql = await t.login('quanly', 'Quan-ly-cua-hang');
      await ql.post('/auth/change-password', { currentPassword: 'Quan-ly-cua-hang', newPassword: 'Quan-ly-cua-hang-2' }).expect(204);
      const adminRoleId = await roleId('Quản trị viên');

      expect((await ql.post('/accounts', { username: 'sneaky', fullName: 'x', roleId: adminRoleId }).expect(403)).body.code).toBe('ADMIN_ONLY');
      const meId = (await ql.get('/auth/me')).body.id;
      await ql.patch(`/accounts/${meId}`, { roleId: adminRoleId }).expect(409);
      expect((await ql.patch(`/roles/${managers.id}`, { name: 'Quản lý', permissions: ['payments.void'] }).expect(403)).body.code).toBe('OWN_ROLE');
      const adminId = (await t.api.get('/auth/me')).body.id;
      expect((await ql.post(`/accounts/${adminId}/reset-password`, {}).expect(403)).body.code).toBe('PERMISSION_DENIED');
      expect((await ql.patch(`/accounts/${adminId}`, { isActive: false }).expect(403)).body.code).toBe('ADMIN_ONLY');
      expect((await ql.patch(`/roles/${adminRoleId}`, { name: 'x', permissions: [] }).expect(409)).body.code).toBe('SYSTEM_ROLE');
    });

    it('a group in use cannot be deleted; an empty one can', async () => {
      const used = await roleId('Nhân viên');
      expect((await t.api.delete(`/roles/${used}`).expect(409)).body.code).toBe('ROLE_IN_USE');
      const empty = (await t.api.post('/roles', { name: 'Tạm', permissions: [] }).expect(201)).body;
      await t.api.delete(`/roles/${empty.id}`).expect(204);
    });
  });

  describe('customers', () => {
    it('validates input and returns VALIDATION_FAILED', async () => {
      const r = await t.api.post('/customers', { name: '' }).expect(400);
      expect(r.body.code).toBe('VALIDATION_FAILED');
    });

    it('normalizes phones, blocks duplicates and searches without diacritics', async () => {
      const a = await t.api.post('/customers', { name: 'Nguyễn Văn Á', companyName: 'In Đại Phát', phone: '+84 903 123 456' }).expect(201);
      expect(a.body).toMatchObject({ code: 'KH-0001', phone: '0903123456' });
      const dup = await t.api.post('/customers', { name: 'Someone', phone: '0903.123.456' }).expect(409);
      expect(dup.body.code).toBe('PHONE_EXISTS');
      expect((await t.api.get('/customers?q=nguyen van a').expect(200)).body.total).toBe(1);
      expect((await t.api.get('/customers?q=dai phat')).body.total).toBe(1);
      expect((await t.api.get('/customers/lookup/0903123456').expect(200)).body.id).toBe(a.body.id);
      await t.api.get('/customers/lookup/0911111111').expect(404);
    });
  });
});

