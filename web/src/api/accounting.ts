import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api, unwrap, type Schemas } from './client';

/** Accounting data. Every write refreshes all accounting queries (they all read the same books). */
export const acc = {
  all: ['accounting'] as const,
  periods: ['accounting', 'periods'] as const,
  accounts: ['accounting', 'accounts'] as const,
  openings: ['accounting', 'openings'] as const,
  suppliers: ['accounting', 'suppliers'] as const,
  materials: ['accounting', 'materials'] as const,
  pnl: ['accounting', 'pnl'] as const,
  period: (id: string, view: string, extra?: string) => ['accounting', 'period', id, view, extra ?? ''] as const,
};

const p = (id: string) => ({ path: { id } });

export const usePeriods = () => useQuery({ queryKey: acc.periods, queryFn: () => unwrap(api.GET('/api/v1/accounting/periods')) });
export const useLedgerAccounts = () => useQuery({ queryKey: acc.accounts, queryFn: () => unwrap(api.GET('/api/v1/accounting/accounts')), staleTime: 300_000 });
export const useOpenings = (enabled = true) => useQuery({ queryKey: acc.openings, queryFn: () => unwrap(api.GET('/api/v1/accounting/openings')), enabled });
export const useSuppliers = () => useQuery({ queryKey: acc.suppliers, queryFn: () => unwrap(api.GET('/api/v1/accounting/suppliers')) });
export const useMaterials = () => useQuery({ queryKey: acc.materials, queryFn: () => unwrap(api.GET('/api/v1/accounting/materials')) });
export const usePnl = () => useQuery({ queryKey: acc.pnl, queryFn: () => unwrap(api.GET('/api/v1/accounting/reports/pnl')) });

export const useOverview = (id?: string) =>
  useQuery({ queryKey: acc.period(id ?? '', 'overview'), queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/overview', { params: p(id!) })), enabled: !!id });
export const useJournal = (id?: string) =>
  useQuery({ queryKey: acc.period(id ?? '', 'journal'), queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/journal', { params: p(id!) })), enabled: !!id });
export const useCashBook = (id: string | undefined, account: 'all' | '111' | '112') =>
  useQuery({
    queryKey: acc.period(id ?? '', 'cash', account),
    queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/cash', { params: { path: { id: id! }, query: { account } } })),
    enabled: !!id,
  });
export const useDebts = (id?: string) =>
  useQuery({ queryKey: acc.period(id ?? '', 'debts'), queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/debts', { params: p(id!) })), enabled: !!id });
export const useStock = (id?: string) =>
  useQuery({ queryKey: acc.period(id ?? '', 'stock'), queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/stock', { params: p(id!) })), enabled: !!id });
export const useTax = (id?: string) =>
  useQuery({ queryKey: acc.period(id ?? '', 'tax'), queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/tax', { params: p(id!) })), enabled: !!id });
export const useAssets = (id?: string) =>
  useQuery({ queryKey: acc.period(id ?? '', 'assets'), queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/assets', { params: p(id!) })), enabled: !!id });
export const useGeneralLedger = (id: string | undefined, account: string) =>
  useQuery({
    queryKey: acc.period(id ?? '', 'ledger', account),
    queryFn: () => unwrap(api.GET('/api/v1/accounting/periods/{id}/ledger', { params: { path: { id: id! }, query: { account } } })),
    enabled: !!id && !!account,
  });

/**
 * The month being looked at, kept in the address (?ky=2026-10) so it survives reloads and moves between
 * accounting screens. Defaults to the earliest open month (the one to close next).
 */
export function useSelectedPeriod() {
  const [params, setParams] = useSearchParams();
  const periods = usePeriods();
  const list = periods.data?.periods ?? [];
  const wanted = params.get('ky');
  const fallback = [...list].reverse().find((x) => x.status === 'OPEN') ?? list[0];
  const period = list.find((x) => x.month === wanted) ?? fallback;
  const setMonth = (month: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('ky', month);
      return next;
    });
  return { periods, list, period, setMonth, started: periods.isSuccess && list.length > 0 };
}

export function useAccountingMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries({ queryKey: acc.all }) };
  return {
    start: useMutation({ mutationFn: (month: string) => unwrap(api.POST('/api/v1/accounting/periods/start', { body: { month } })), ...done }),
    runStep: useMutation({
      mutationFn: ({ id, step }: { id: string; step: Schemas['ClosingStep'] }) => unwrap(api.POST('/api/v1/accounting/periods/{id}/steps/{step}', { params: { path: { id, step } } })),
      ...done,
    }),
    close: useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/accounting/periods/{id}/close', { params: p(id) })), ...done }),
    reopen: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/accounting/periods/{id}/reopen', { params: p(id), body: { reason } })), ...done }),
    saveOpenings: useMutation({ mutationFn: (body: Schemas['SaveOpeningsDto']) => unwrap(api.PUT('/api/v1/accounting/openings', { body })), ...done }),
    saveStockOpenings: useMutation({ mutationFn: (body: Schemas['SaveStockOpeningsDto']) => unwrap(api.PUT('/api/v1/accounting/openings/stock', { body })), ...done }),
    saveSupplier: useMutation({
      mutationFn: ({ id, body }: { id?: string; body: Schemas['SaveSupplierDto'] }) =>
        id ? unwrap(api.PUT('/api/v1/accounting/suppliers/{id}', { params: p(id), body })) : unwrap(api.POST('/api/v1/accounting/suppliers', { body })),
      ...done,
    }),
    saveMaterial: useMutation({
      mutationFn: ({ id, body }: { id?: string; body: Schemas['SaveMaterialDto'] }) =>
        id ? unwrap(api.PUT('/api/v1/accounting/materials/{id}', { params: p(id), body })) : unwrap(api.POST('/api/v1/accounting/materials', { body })),
      ...done,
    }),
    saveCategory: useMutation({
      mutationFn: ({ id, body }: { id?: string; body: Schemas['SaveCategoryDto'] }) =>
        id ? unwrap(api.PUT('/api/v1/accounting/categories/{id}', { params: p(id), body })) : unwrap(api.POST('/api/v1/accounting/categories', { body })),
      ...done,
    }),
    createReceipt: useMutation({ mutationFn: (body: Schemas['CreateReceiptDto']) => unwrap(api.POST('/api/v1/accounting/receipts', { body })), ...done }),
    deleteReceipt: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/accounting/receipts/{id}', { params: p(id) })), ...done }),
    createIssue: useMutation({ mutationFn: (body: Schemas['CreateIssueDto']) => unwrap(api.POST('/api/v1/accounting/issues', { body })), ...done }),
    deleteIssue: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/accounting/issues/{id}', { params: p(id) })), ...done }),
    createCashPayment: useMutation({ mutationFn: (body: Schemas['CreateCashPaymentDto']) => unwrap(api.POST('/api/v1/accounting/cash-payments', { body })), ...done }),
    createAsset: useMutation({ mutationFn: (body: Schemas['CreateAssetDto']) => unwrap(api.POST('/api/v1/accounting/assets', { body })), ...done }),
    deleteAsset: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/accounting/assets/{id}', { params: p(id) })), ...done }),
    createEntry: useMutation({ mutationFn: (body: Schemas['CreateManualEntryDto']) => unwrap(api.POST('/api/v1/accounting/entries', { body })), ...done }),
    updateEntry: useMutation({ mutationFn: ({ id, body }: { id: string; body: Schemas['UpdateEntryDto'] }) => unwrap(api.PUT('/api/v1/accounting/entries/{id}', { params: p(id), body })), ...done }),
    deleteEntry: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/accounting/entries/{id}', { params: p(id) })), ...done }),
  };
}
