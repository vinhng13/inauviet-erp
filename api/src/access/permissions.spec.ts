import { ALL_PERMISSIONS, DEFAULT_ROLES, normalizePermissions } from './permissions';

describe('permissions', () => {
  it('has unique module.action keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS).toContain('deliveries.deliver');
  });

  it('adds implied permissions and drops unknown keys', () => {
    expect(normalizePermissions(['payments.void', 'nope.x'])).toEqual(['orders.view', 'payments.view', 'payments.void', 'money.view']);
  });

  it('keeps the delivery group away from money', () => {
    const driver = DEFAULT_ROLES.find((r) => r.name === 'Giao hàng')!;
    expect(driver.permissions).toEqual(['orders.view', 'deliveries.view', 'deliveries.deliver', 'deliveries.accept', 'customers.view']);
  });

  it('keeps designers and the workshop away from money', () => {
    for (const name of ['Thiết kế', 'Sản xuất']) {
      const group = DEFAULT_ROLES.find((r) => r.name === name)!;
      expect(group.permissions).toContain('orders.view');
      expect(group.permissions).not.toContain('money.view');
    }
  });
});
