import { useMe } from '../api/hooks';

/**
 * Permission keys, e.g. "orders.create". The server enforces every rule; the UI only hides what
 * the account can't use. Keep in sync with api/src/access/permissions.ts.
 */
export type Permission =
  | 'quotes.view' | 'quotes.create' | 'quotes.update' | 'quotes.close'
  | 'orders.view' | 'orders.create' | 'orders.update' | 'orders.cancel'
  | 'design.view' | 'design.assign' | 'design.work'
  | 'production.view' | 'production.update'
  | 'deliveries.view' | 'deliveries.create' | 'deliveries.update' | 'deliveries.deliver' | 'deliveries.cancel' | 'deliveries.reopen' | 'deliveries.accept'
  | 'payments.view' | 'payments.create' | 'payments.void'
  | 'accounting.view' | 'accounting.post' | 'accounting.close' | 'accounting.reopen'
  | 'money.view'
  | 'customers.view' | 'customers.create' | 'customers.update'
  | 'products.view' | 'products.manage'
  | 'accounts.view' | 'accounts.create' | 'accounts.update' | 'accounts.resetPassword'
  | 'roles.view' | 'roles.manage';

/** `const can = useCan(); can('orders.create')` */
export function useCan(): (permission: Permission) => boolean {
  const { data: me } = useMe();
  return (permission) => !!me && (me.isAdmin || me.permissions.includes(permission));
}
