import dayjs from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

const vnd = new Intl.NumberFormat('vi-VN');

/** 2500000 → "2.500.000 đ" */
export function formatVnd(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${vnd.format(value)} đ`;
}

export function formatQty(value: number): string {
  return vnd.format(value);
}

/** "2026-11-02" → "02/11/2026" */
export function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('DD/MM/YYYY') : '—';
}

/** "2026-11-02" → "T2 02/11" (short, for cards) */
export function formatShortDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('dd DD/MM') : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dayjs(value).format('HH:mm DD/MM/YYYY') : '—';
}

export function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

/** InputNumber helpers: thousands separators with dots, whole numbers only. */
export const vndInputProps = {
  formatter: (v: string | number | undefined) => (v === undefined || v === '' ? '' : vnd.format(Number(String(v).replace(/\./g, '')))),
  parser: (v: string | undefined) => Number((v ?? '').replace(/[^\d]/g, '')) as unknown as 0,
  precision: 0,
  min: 0,
  suffix: 'đ',
} as const;
