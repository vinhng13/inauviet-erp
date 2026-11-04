import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap, type Schemas } from './client';

/**
 * Server data lives only in TanStack Query. No live updates: queries refetch when a page opens
 * and when the browser tab regains focus. Every mutation invalidates what it affects.
 */
export const keys = {
  me: ['me'] as const,
  board: (q: object) => ['board', q] as const,
  orders: (q: object) => ['orders', q] as const,
  order: (id: string) => ['order', id] as const,
  activity: (id: string) => ['order', id, 'activity'] as const,
  deliveries: (q: object) => ['deliveries', q] as const,
  customers: (q: object) => ['customers', q] as const,
  customer: (id: string) => ['customer', id] as const,
  customerDocs: (id: string) => ['customer', id, 'documents'] as const,
  products: (q: object) => ['products', q] as const,
  quotes: (q: object) => ['quotes', q] as const,
  quote: (id: string) => ['quote', id] as const,
  quoteActivity: (id: string) => ['quote', id, 'activity'] as const,
  designQueue: (q: object) => ['design-queue', q] as const,
  designers: ['designers'] as const,
  production: ['production'] as const,
  payments: (q: object) => ['payments', q] as const,
  receivables: (q: object) => ['receivables', q] as const,
  accounts: ['accounts'] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
};

type BoardQuery = { q?: string; due?: 'week' | 'overdue'; hasUnplanned?: boolean };
type OrderQuery = { q?: string; status?: Schemas['OrderStatus']; customerId?: string; hasUnplanned?: boolean; overdue?: boolean; page?: number; pageSize?: number };
type DeliveryQuery = { q?: string; status?: Schemas['DeliveryStatus']; from?: string; to?: string; overdue?: boolean; page?: number; pageSize?: number };
type CustomerQuery = { q?: string; page?: number; pageSize?: number };
type QuoteQuery = { q?: string; status?: Schemas['QuoteStatus']; customerId?: string; page?: number; pageSize?: number };

/** The signed-in account. Resolves to null when nobody is signed in (401). */
export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await unwrap(api.GET('/api/v1/auth/me'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

export function useAuthActions() {
  const qc = useQueryClient();
  // Drop everything cached for the previous account, but keep the "me" query: the sign-in gate is watching it.
  const forgetOtherData = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  return {
    login: useMutation({
      mutationFn: (body: Schemas['LoginDto']) => unwrap(api.POST('/api/v1/auth/login', { body })),
      onSuccess: (me) => {
        forgetOtherData();
        qc.setQueryData(keys.me, me);
      },
    }),
    logout: useMutation({
      mutationFn: () => unwrap(api.POST('/api/v1/auth/logout')),
      onSettled: () => {
        forgetOtherData();
        qc.setQueryData(keys.me, null);
      },
    }),
    changePassword: useMutation({
      mutationFn: (body: Schemas['ChangePasswordDto']) => unwrap(api.POST('/api/v1/auth/change-password', { body })),
      onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
    }),
  };
}

export const useBoard = (q: BoardQuery) =>
  useQuery({ queryKey: keys.board(q), queryFn: () => unwrap(api.GET('/api/v1/board', { params: { query: q } })), placeholderData: keepPreviousData });

export const useOrders = (q: OrderQuery, enabled = true) =>
  useQuery({ queryKey: keys.orders(q), enabled, queryFn: () => unwrap(api.GET('/api/v1/orders', { params: { query: q } })), placeholderData: keepPreviousData });

export const useOrder = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.order(id), enabled: enabled && !!id, queryFn: () => unwrap(api.GET('/api/v1/orders/{id}', { params: { path: { id } } })) });

export const useOrderActivity = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.activity(id), enabled, queryFn: () => unwrap(api.GET('/api/v1/orders/{id}/activity', { params: { path: { id } } })) });

export const useDeliveries = (q: DeliveryQuery) =>
  useQuery({ queryKey: keys.deliveries(q), queryFn: () => unwrap(api.GET('/api/v1/deliveries', { params: { query: q } })), placeholderData: keepPreviousData });

export const useCustomers = (q: CustomerQuery) =>
  useQuery({ queryKey: keys.customers(q), queryFn: () => unwrap(api.GET('/api/v1/customers', { params: { query: q } })), placeholderData: keepPreviousData });

export const useCustomer = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.customer(id), enabled: enabled && !!id, queryFn: () => unwrap(api.GET('/api/v1/customers/{id}', { params: { path: { id } } })) });

export const useCustomerDocuments = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.customerDocs(id), enabled: enabled && !!id, queryFn: () => unwrap(api.GET('/api/v1/customers/{id}/documents', { params: { path: { id } } })) });

export const useProducts = (q: { active?: boolean; q?: string } = {}, enabled = true) =>
  useQuery({ queryKey: keys.products(q), enabled, staleTime: 60_000, queryFn: () => unwrap(api.GET('/api/v1/products', { params: { query: q } })) });

export const useQuotes = (q: QuoteQuery) =>
  useQuery({ queryKey: keys.quotes(q), queryFn: () => unwrap(api.GET('/api/v1/quotes', { params: { query: q } })), placeholderData: keepPreviousData });

export const useQuote = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.quote(id), enabled, queryFn: () => unwrap(api.GET('/api/v1/quotes/{id}', { params: { path: { id } } })) });

export const useQuoteActivity = (id: string) =>
  useQuery({ queryKey: keys.quoteActivity(id), queryFn: () => unwrap(api.GET('/api/v1/quotes/{id}/activity', { params: { path: { id } } })) });

export const useDesignQueue = (q: { mine?: boolean }) =>
  useQuery({ queryKey: keys.designQueue(q), queryFn: () => unwrap(api.GET('/api/v1/design-queue', { params: { query: q } })), placeholderData: keepPreviousData });

export const useDesigners = (enabled = true) =>
  useQuery({ queryKey: keys.designers, enabled, staleTime: 60_000, queryFn: () => unwrap(api.GET('/api/v1/designers')) });

export const useProduction = () => useQuery({ queryKey: keys.production, queryFn: () => unwrap(api.GET('/api/v1/production')) });

type PaymentQuery = { q?: string; from?: string; to?: string; method?: Schemas['PaymentMethod']; includeVoided?: boolean; page?: number; pageSize?: number };
export const usePayments = (q: PaymentQuery, enabled = true) =>
  useQuery({ queryKey: keys.payments(q), enabled, queryFn: () => unwrap(api.GET('/api/v1/payments', { params: { query: q } })), placeholderData: keepPreviousData });

export const useReceivables = (q: { q?: string; deliveredOnly?: boolean }, enabled = true) =>
  useQuery({ queryKey: keys.receivables(q), enabled, queryFn: () => unwrap(api.GET('/api/v1/receivables', { params: { query: q } })), placeholderData: keepPreviousData });

export const useAccounts = (enabled = true) =>
  useQuery({ queryKey: keys.accounts, enabled, queryFn: () => unwrap(api.GET('/api/v1/accounts')) });

export const useRoles = (enabled = true) => useQuery({ queryKey: keys.roles, enabled, queryFn: () => unwrap(api.GET('/api/v1/roles')) });

export const usePermissionCatalog = () =>
  useQuery({ queryKey: keys.permissions, staleTime: Infinity, queryFn: () => unwrap(api.GET('/api/v1/permissions')) });

/** After any order/delivery/payment change, everything that shows orders may be stale. */
function useInvalidateOrders() {
  const qc = useQueryClient();
  return (orderId?: string) => {
    void qc.invalidateQueries({ queryKey: ['board'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['deliveries'] });
    void qc.invalidateQueries({ queryKey: ['customer'] });
    void qc.invalidateQueries({ queryKey: ['design-queue'] });
    void qc.invalidateQueries({ queryKey: ['production'] });
    void qc.invalidateQueries({ queryKey: ['payments'] });
    void qc.invalidateQueries({ queryKey: ['receivables'] });
    void qc.invalidateQueries({ queryKey: ['designers'] });
    if (orderId) void qc.invalidateQueries({ queryKey: ['order', orderId] });
  };
}

export function useCreateOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (body: Schemas['CreateOrderDto']) => unwrap(api.POST('/api/v1/orders', { body })),
    onSuccess: (o) => invalidate(o.id),
  });
}

export function useOrderActions(orderId: string) {
  const invalidate = useInvalidateOrders();
  const done = { onSuccess: () => invalidate(orderId) };
  const path = { path: { id: orderId } };
  return {
    update: useMutation({ mutationFn: (body: Schemas['UpdateOrderDto']) => unwrap(api.PATCH('/api/v1/orders/{id}', { params: path, body })), ...done }),
    replaceLines: useMutation({ mutationFn: (body: Schemas['ReplaceLinesDto']) => unwrap(api.PUT('/api/v1/orders/{id}/lines', { params: path, body })), ...done }),
    confirm: useMutation({ mutationFn: (needsDesign: boolean) => unwrap(api.POST('/api/v1/orders/{id}/confirm', { params: path, body: { needsDesign } })), ...done }),
    assignDesigner: useMutation({ mutationFn: (designerId: string | null) => unwrap(api.PATCH('/api/v1/orders/{id}/design', { params: path, body: { designerId } })), ...done }),
    sendDesign: useMutation({ mutationFn: (body: Schemas['SendDesignDto']) => unwrap(api.POST('/api/v1/orders/{id}/design/versions', { params: path, body })), ...done }),
    designFeedback: useMutation({
      mutationFn: ({ versionId, body }: { versionId: string; body: Schemas['DesignFeedbackDto'] }) =>
        unwrap(api.POST('/api/v1/orders/{id}/design/versions/{versionId}/feedback', { params: { path: { id: orderId, versionId } }, body })),
      ...done,
    }),
    updateApproval: useMutation({ mutationFn: (body: Schemas['UpdateApprovalDto']) => unwrap(api.PATCH('/api/v1/orders/{id}/design/approval', { params: path, body })), ...done }),
    unapprove: useMutation({ mutationFn: (reason: string) => unwrap(api.POST('/api/v1/orders/{id}/design/unapprove', { params: path, body: { reason } })), ...done }),
    lockDesign: useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/orders/{id}/design/lock', { params: path })), ...done }),
    updateProduction: useMutation({ mutationFn: (body: Schemas['UpdateProductionDto']) => unwrap(api.PATCH('/api/v1/orders/{id}/production', { params: path, body })), ...done }),
    advance: useMutation({ mutationFn: (stage?: Schemas['ProductionStage']) => unwrap(api.POST('/api/v1/orders/{id}/production/advance', { params: path, body: { stage } })), ...done }),
    handover: useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/orders/{id}/production/handover', { params: path })), ...done }),
    accept: useMutation({ mutationFn: (body: Schemas['AcceptOrderDto']) => unwrap(api.POST('/api/v1/orders/{id}/accept', { params: path, body })), ...done }),
    cancel: useMutation({ mutationFn: (reason: string) => unwrap(api.POST('/api/v1/orders/{id}/cancel', { params: path, body: { reason } })), ...done }),
    addTrip: useMutation({
      mutationFn: (body: Schemas['CreateDeliveryDto']) => unwrap(api.POST('/api/v1/orders/{orderId}/deliveries', { params: { path: { orderId } }, body })),
      ...done,
    }),
    addPayment: useMutation({
      mutationFn: (body: Schemas['CreatePaymentDto']) => unwrap(api.POST('/api/v1/orders/{orderId}/payments', { params: { path: { orderId } }, body })),
      ...done,
    }),
  };
}

export function useDeliveryActions(orderId?: string) {
  const invalidate = useInvalidateOrders();
  const done = { onSuccess: (d: { orderId: string }) => invalidate(orderId ?? d.orderId) };
  return {
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['UpdateDeliveryDto'] }) => unwrap(api.PATCH('/api/v1/deliveries/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
    deliver: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['DeliverDto'] }) => unwrap(api.POST('/api/v1/deliveries/{id}/deliver', { params: { path: { id } }, body })),
      ...done,
    }),
    reopen: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/deliveries/{id}/reopen', { params: { path: { id } }, body: { reason } })),
      ...done,
    }),
    cancel: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/deliveries/{id}/cancel', { params: { path: { id } }, body: { reason } })),
      ...done,
    }),
  };
}

export function useVoidPayment(orderId: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/payments/{id}/void', { params: { path: { id } }, body: { reason } })),
    onSuccess: () => invalidate(orderId),
  });
}

export function useProductMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }) };
  return {
    create: useMutation({ mutationFn: (body: Schemas['CreateProductDto']) => unwrap(api.POST('/api/v1/products', { body })), ...done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Schemas['UpdateProductDto'] & { id: string }) => unwrap(api.PATCH('/api/v1/products/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
  };
}

export function useQuoteMutations() {
  const qc = useQueryClient();
  const invalidateOrders = useInvalidateOrders();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['quotes'] });
    if (id) void qc.invalidateQueries({ queryKey: ['quote', id] });
  };
  const path = (id: string) => ({ path: { id } });
  return {
    create: useMutation({ mutationFn: (body: Schemas['SaveQuoteDto']) => unwrap(api.POST('/api/v1/quotes', { body })), onSuccess: (q) => refresh(q.id) }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['SaveQuoteDto'] }) => unwrap(api.PUT('/api/v1/quotes/{id}', { params: path(id), body })),
      onSuccess: (q) => refresh(q.id),
    }),
    send: useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/quotes/{id}/send', { params: path(id) })), onSuccess: (q) => refresh(q.id) }),
    lose: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/quotes/{id}/lose', { params: path(id), body: { reason } })),
      onSuccess: (q) => refresh(q.id),
    }),
    reopen: useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/quotes/{id}/reopen', { params: path(id) })), onSuccess: (q) => refresh(q.id) }),
    close: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['CloseQuoteDto'] }) => unwrap(api.POST('/api/v1/quotes/{id}/close', { params: path(id), body })),
      onSuccess: (r, v) => {
        refresh(v.id);
        invalidateOrders(r.orderId);
      },
    }),
  };
}

export function useCustomerMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => void qc.invalidateQueries({ queryKey: ['customers'] }) };
  return {
    create: useMutation({ mutationFn: (body: Schemas['CreateCustomerDto']) => unwrap(api.POST('/api/v1/customers', { body })), ...done }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['UpdateCustomerDto'] }) => unwrap(api.PATCH('/api/v1/customers/{id}', { params: { path: { id } }, body })),
      onSuccess: (c: Schemas['CustomerDto']) => {
        void qc.invalidateQueries({ queryKey: ['customers'] });
        void qc.invalidateQueries({ queryKey: ['customer', c.id] });
      },
    }),
  };
}

export function useAccountMutations() {
  const qc = useQueryClient();
  const done = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.accounts });
      void qc.invalidateQueries({ queryKey: keys.roles });
    },
  };
  return {
    create: useMutation({ mutationFn: (body: Schemas['CreateAccountDto']) => unwrap(api.POST('/api/v1/accounts', { body })), ...done }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['UpdateAccountDto'] }) => unwrap(api.PATCH('/api/v1/accounts/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
    resetPassword: useMutation({
      mutationFn: ({ id, password }: { id: string; password?: string }) =>
        unwrap(api.POST('/api/v1/accounts/{id}/reset-password', { params: { path: { id } }, body: { password } })),
      ...done,
    }),
    signOut: useMutation({
      mutationFn: (id: string) => unwrap(api.POST('/api/v1/accounts/{id}/sign-out', { params: { path: { id } } })),
    }),
  };
}

export function useRoleMutations() {
  const qc = useQueryClient();
  const done = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.roles });
      void qc.invalidateQueries({ queryKey: keys.accounts });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  };
  return {
    create: useMutation({ mutationFn: (body: Schemas['SaveRoleDto']) => unwrap(api.POST('/api/v1/roles', { body })), ...done }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Schemas['SaveRoleDto'] }) => unwrap(api.PATCH('/api/v1/roles/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
    remove: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/roles/{id}', { params: { path: { id } } })), ...done }),
  };
}
