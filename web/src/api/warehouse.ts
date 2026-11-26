import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap, type Schemas } from './client';
import type { operations } from './schema';

/** Kho data. Every write refreshes all warehouse queries (stock, dies and overview depend on each other). */
export const wh = {
  all: ['warehouse'] as const,
  key: (...parts: Array<string | number | boolean | undefined | null | object>) => ['warehouse', ...parts] as const,
};

export type DieQuery = NonNullable<operations['Warehouse_dieList']['parameters']['query']>;
export type DieRow = Schemas['DieRowDto'];
export type Die = Schemas['DieDto'];
export type StockItem = Schemas['StockItemDto'];

const p = (id: string) => ({ path: { id } });

export const useWhOverview = () => useQuery({ queryKey: wh.key('overview'), queryFn: () => unwrap(api.GET('/api/v1/warehouse/overview')) });
/** Nơi lấy hàng đã ghi trên phiếu nhập (chữ), để gợi ý */
export const useSuppliers = () => useQuery({ queryKey: wh.key('suppliers'), queryFn: () => unwrap(api.GET('/api/v1/warehouse/suppliers')), staleTime: 60_000 });
export const useWhPeople = (enabled = true) => useQuery({ queryKey: wh.key('people'), enabled, queryFn: () => unwrap(api.GET('/api/v1/warehouse/people')), staleTime: 300_000 });
export const useLocations = () => useQuery({ queryKey: wh.key('locations'), queryFn: () => unwrap(api.GET('/api/v1/warehouse/locations')), staleTime: 60_000 });
export const useSymbols = () => useQuery({ queryKey: wh.key('symbols'), queryFn: () => unwrap(api.GET('/api/v1/warehouse/symbols')), staleTime: 60_000 });
export const useWhMaterials = () => useQuery({ queryKey: wh.key('materials'), queryFn: () => unwrap(api.GET('/api/v1/warehouse/materials')) });
export const useWarehouses = () => useQuery({ queryKey: wh.key('warehouses'), queryFn: () => unwrap(api.GET('/api/v1/warehouse/warehouses')), staleTime: 30_000 });
export const useStockItems = (warehouseId?: string, all = false) =>
  useQuery({
    queryKey: wh.key('stock', warehouseId, all),
    enabled: !!warehouseId,
    queryFn: () => unwrap(api.GET('/api/v1/warehouse/stock', { params: { query: { warehouseId, all: all ? 'true' : 'false' } } })),
  });
export const useStockReport = (q?: { warehouseId: string; from: string; to: string }) =>
  useQuery({ queryKey: wh.key('report', q), enabled: !!q?.warehouseId, queryFn: () => unwrap(api.GET('/api/v1/warehouse/reports/stock', { params: { query: q! } })) });
export const useStockAsOf = (q?: { warehouseId: string; date: string }) =>
  useQuery({ queryKey: wh.key('asof', q), enabled: !!q?.warehouseId, queryFn: () => unwrap(api.GET('/api/v1/warehouse/reports/as-of', { params: { query: q! } })) });
export const useStockCard = (id?: string) =>
  useQuery({ queryKey: wh.key('card', id), enabled: !!id, queryFn: () => unwrap(api.GET('/api/v1/warehouse/stock/{id}/card', { params: p(id!) })) });
export type SlipQuery = NonNullable<operations['Warehouse_slips']['parameters']['query']>;
export const useSlips = (q: SlipQuery, enabled = true) =>
  useQuery({ queryKey: wh.key('slips', q), enabled, placeholderData: keepPreviousData, queryFn: () => unwrap(api.GET('/api/v1/warehouse/slips', { params: { query: q } })) });
export const useSlip = (id?: string) =>
  useQuery({ queryKey: wh.key('slip', id), enabled: !!id, queryFn: () => unwrap(api.GET('/api/v1/warehouse/slips/{id}', { params: p(id!) })) });
export const useDies = (q: DieQuery, enabled = true) =>
  useQuery({ queryKey: wh.key('dies', q), enabled, placeholderData: keepPreviousData, queryFn: () => unwrap(api.GET('/api/v1/warehouse/dies', { params: { query: q } })) });
export const useDie = (id?: string) =>
  useQuery({ queryKey: wh.key('die', id), enabled: !!id, queryFn: () => unwrap(api.GET('/api/v1/warehouse/dies/{id}', { params: p(id!) })) });
export type Batch = Schemas['BatchDto'];
export const useBatches = (tab: 'mine' | 'open' | 'all', place?: string) =>
  useQuery({ queryKey: wh.key('batches', tab, place), placeholderData: keepPreviousData, queryFn: () => unwrap(api.GET('/api/v1/warehouse/batches', { params: { query: { tab, place } } })) });
export const useBatch = (id?: string) =>
  useQuery({ queryKey: wh.key('batch', id), enabled: !!id, queryFn: () => unwrap(api.GET('/api/v1/warehouse/batches/{id}', { params: p(id!) })) });
export type DieJournalQuery = NonNullable<operations['Warehouse_dieJournal']['parameters']['query']>;
export const useDieJournal = (q: DieJournalQuery) =>
  useQuery({ queryKey: wh.key('dieJournal', q), placeholderData: keepPreviousData, queryFn: () => unwrap(api.GET('/api/v1/warehouse/die-journal', { params: { query: q } })) });

/** multipart upload; openapi-fetch does not build FormData for us */
async function upload<T>(url: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', body: form, credentials: 'include' });
  const body = res.status === 204 ? undefined : await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError({ statusCode: res.status, code: body?.code ?? `HTTP_${res.status}`, message: body?.message ?? res.statusText, details: body?.details });
  return body as T;
}

export const diePhotoUrl = (id: string, v?: string | number) => `/api/v1/warehouse/dies/${id}/photo${v ? `?v=${v}` : ''}`;

export function useWarehouseMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries({ queryKey: wh.all }) };
  return {
    saveLocation: useMutation({
      mutationFn: ({ id, ...body }: Schemas['LocationInputDto'] & { id?: string }) =>
        unwrap(id ? api.PUT('/api/v1/warehouse/locations/{id}', { params: p(id), body }) : api.POST('/api/v1/warehouse/locations', { body })),
      ...done,
    }),
    saveSymbol: useMutation({ mutationFn: (body: Schemas['SymbolInputDto']) => unwrap(api.PUT('/api/v1/warehouse/symbols', { body })), ...done }),
    saveMaterial: useMutation({
      mutationFn: ({ id, ...body }: Schemas['WhMaterialInputDto'] & { id?: string }) =>
        unwrap(id ? api.PUT('/api/v1/warehouse/materials/{id}', { params: p(id), body }) : api.POST('/api/v1/warehouse/materials', { body })),
      ...done,
    }),
    saveWarehouse: useMutation({
      mutationFn: ({ id, ...body }: Schemas['WarehouseInputDto'] & { id?: string }) =>
        unwrap(id ? api.PUT('/api/v1/warehouse/warehouses/{id}', { params: p(id), body }) : api.POST('/api/v1/warehouse/warehouses', { body })),
      ...done,
    }),
    updateStock: useMutation({ mutationFn: ({ id, ...body }: Schemas['StockUpdateDto'] & { id: string }) => unwrap(api.PUT('/api/v1/warehouse/stock/{id}', { params: p(id), body })), ...done }),
    createSlip: useMutation({ mutationFn: (body: Schemas['SlipInputDto']) => unwrap(api.POST('/api/v1/warehouse/slips', { body })), ...done }),
    createTransfer: useMutation({ mutationFn: (body: Schemas['TransferInputDto']) => unwrap(api.POST('/api/v1/warehouse/transfers', { body })), ...done }),
    runSnapshots: useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/warehouse/snapshots/run')), ...done }),
    voidSlip: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/warehouse/slips/{id}/void', { params: p(id), body: { reason } })), ...done }),
    createDie: useMutation({ mutationFn: (body: Schemas['DieInputDto']) => unwrap(api.POST('/api/v1/warehouse/dies', { body })), ...done }),
    updateDie: useMutation({ mutationFn: ({ id, ...body }: Schemas['DieInputDto'] & { id: string }) => unwrap(api.PUT('/api/v1/warehouse/dies/{id}', { params: p(id), body })), ...done }),
    dieAction: useMutation({ mutationFn: ({ id, ...body }: Schemas['DieActionDto'] & { id: string }) => unwrap(api.POST('/api/v1/warehouse/dies/{id}/actions', { params: p(id), body })), ...done }),
    diePhoto: useMutation({ mutationFn: ({ id, file }: { id: string; file: File }) => upload<void>(`/api/v1/warehouse/dies/${id}/photo`, file), ...done }),
    importDies: useMutation({
      mutationFn: ({ file, dryRun, warehouseId }: { file: File; dryRun: boolean; warehouseId?: string }) =>
        upload<Schemas['ImportReportDto']>(`/api/v1/warehouse/dies/import?dryRun=${dryRun}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`, file),
      ...done,
    }),
    importPaper: useMutation({
      mutationFn: ({ file, dryRun, warehouseId }: { file: File; dryRun: boolean; warehouseId?: string }) =>
        upload<Schemas['PaperImportReportDto']>(`/api/v1/warehouse/materials/import-paper?dryRun=${dryRun}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`, file),
      ...done,
    }),
    createBatch: useMutation({ mutationFn: (body: Schemas['BatchInputDto']) => unwrap(api.POST('/api/v1/warehouse/batches', { body })), ...done }),
    sendBatch: useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/warehouse/batches/{id}/send', { params: p(id) })), ...done }),
    receiveBatch: useMutation({
      mutationFn: ({ id, locationId, locationCode }: { id: string; locationId?: string | null; locationCode?: string | null }) =>
        unwrap(api.POST('/api/v1/warehouse/batches/{id}/receive', { params: p(id), body: { locationId: locationId ?? null, locationCode: locationCode ?? null } })),
      ...done,
    }),
    rejectBatch: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => unwrap(api.POST('/api/v1/warehouse/batches/{id}/reject', { params: p(id), body: { reason } })), ...done }),
    cancelBatch: useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/warehouse/batches/{id}/cancel', { params: p(id) })), ...done }),
  };
}
