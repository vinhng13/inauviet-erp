/**
 * Pure accounting helpers: months, amounts, depreciation, weighted average, balances.
 * Money is whole đồng as bigint; a balance is debit-positive (credit balances are negative).
 */

export const DEFAULT_VAT_RATE = 8;
export const VAT_RATES = [0, 5, 8, 10];

/** Accounts whose charge a month-end step or an expense can carry */
export const COST_ACCOUNTS = ['154', '6421', '6422'] as const;
/** Revenue and expense accounts closed into 911 each month */
export const REVENUE_ACCOUNTS = ['511', '515', '711'];
export const EXPENSE_ACCOUNTS = ['632', '635', '6421', '6422', '811', '821'];

/** Month-end steps, in the order they must run */
export const STEPS = ['price', 'depreciation', 'allocation', 'vat', 'transfer'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_COLUMN: Record<Step, 'pricedAt' | 'depreciatedAt' | 'allocatedAt' | 'vatOffsetAt' | 'transferredAt'> = {
  price: 'pricedAt',
  depreciation: 'depreciatedAt',
  allocation: 'allocatedAt',
  vat: 'vatOffsetAt',
  transfer: 'transferredAt',
};

// ───────────── Months ("YYYY-MM") ─────────────

export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function monthNumber(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function monthFromNumber(n: number): string {
  const y = Math.floor(n / 12);
  const m = (n % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export const nextMonth = (month: string) => monthFromNumber(monthNumber(month) + 1);
export const monthsBetween = (from: string, to: string) => monthNumber(to) - monthNumber(from);

export function firstDay(month: string): string {
  return `${month}-01`;
}

export function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** "2026-10" → "10/2026" for people */
export function monthLabel(month: string): string {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

/** "2026-10" → "2610" for document codes */
export function monthCode(month: string): string {
  return month.slice(2, 4) + month.slice(5, 7);
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// ───────────── Amounts ─────────────

/** 1234567n → "1.234.567 đ" (for summaries and log lines) */
export function vnd(value: bigint): string {
  const neg = value < 0n;
  const digits = (neg ? -value : value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${digits} đ`;
}

export function vatOf(amount: bigint, rate: number): bigint {
  return (amount * BigInt(rate) + 50n) / 100n;
}

/** qty (up to 3 decimals) × unit price, rounded to the đồng */
export function valueOf(qty: number, price: bigint): bigint {
  const milli = BigInt(Math.round(qty * 1000));
  return (milli * price + 500n) / 1000n;
}

/** Split an amount by percents; the last part takes the rounding difference so the parts add up exactly. */
export function splitAmount(amount: bigint, parts: Array<{ account: string; percent: number }>): Array<{ account: string; amount: bigint }> {
  let used = 0n;
  return parts.map((p, i) => {
    const v = i === parts.length - 1 ? amount - used : (amount * BigInt(Math.round(p.percent * 100)) + 5000n) / 10000n;
    used += v;
    return { account: p.account, amount: v };
  });
}

/**
 * Straight-line monthly charge of an asset in a given month: cost / months, the last month taking the rounding
 * difference; 0 before the start or after the last month.
 */
export function monthlyCharge(cost: bigint, months: number, startMonth: string, month: string): bigint {
  const idx = monthsBetween(startMonth, month);
  if (idx < 0 || idx >= months) return 0n;
  const regular = (cost + BigInt(months) / 2n) / BigInt(months);
  return idx === months - 1 ? cost - regular * BigInt(months - 1) : regular;
}

/** Charged so far, through `month` included when `includeMonth` */
export function chargedThrough(cost: bigint, months: number, startMonth: string, month: string, includeMonth: boolean): bigint {
  const done = Math.min(months, Math.max(0, monthsBetween(startMonth, month) + (includeMonth ? 1 : 0)));
  if (done <= 0) return 0n;
  if (done >= months) return cost;
  const regular = (cost + BigInt(months) / 2n) / BigInt(months);
  return regular * BigInt(done);
}

/** Monthly weighted average unit cost: (opening value + received value) / (opening qty + received qty) */
export function weightedAverage(openQty: number, openPrice: bigint, inQty: number, inValue: bigint): bigint {
  const qty = openQty + inQty;
  if (qty <= 0) return openPrice;
  const value = valueOf(openQty, openPrice) + inValue;
  const milli = BigInt(Math.round(qty * 1000));
  return (value * 1000n + milli / 2n) / milli;
}

// ───────────── Balances ─────────────

export interface LineLike {
  accountCode: string;
  debitVnd: bigint;
  creditVnd: bigint;
}

/** opening + movements, debit-positive */
export function applyLines(opening: Map<string, bigint>, lines: LineLike[]): Map<string, bigint> {
  const out = new Map(opening);
  for (const l of lines) out.set(l.accountCode, (out.get(l.accountCode) ?? 0n) + l.debitVnd - l.creditVnd);
  return out;
}

export function sumBy(lines: LineLike[], account: string, side: 'debit' | 'credit'): bigint {
  return lines.reduce((s, l) => (l.accountCode === account ? s + (side === 'debit' ? l.debitVnd : l.creditVnd) : s), 0n);
}

/** Net movement on the account's own side: credit − debit for revenue accounts, debit − credit for expenses */
export function netCredit(lines: LineLike[], account: string): bigint {
  return sumBy(lines, account, 'credit') - sumBy(lines, account, 'debit');
}

export function isBalanced(lines: Array<{ debitVnd: bigint; creditVnd: bigint }>): boolean {
  const d = lines.reduce((s, l) => s + l.debitVnd, 0n);
  const c = lines.reduce((s, l) => s + l.creditVnd, 0n);
  return d === c && d > 0n;
}

export interface ProfitParts {
  revenue: bigint;
  cogs: bigint;
  selling: bigint;
  admin: bigint;
  /** 515 + 711 − 635 − 811 − 821 */
  otherNet: bigint;
  profit: bigint;
}

export interface OverheadLine extends LineLike {
  kind: string;
  orderId?: string | null;
}

/**
 * Production overhead of a month: what was charged to 154 other than materials issued for a specific order
 * (those stay in 154 as work in progress until the order's cost of goods is posted).
 */
export function overheadOf(lines: OverheadLine[]): bigint {
  return lines
    .filter((l) => l.accountCode === '154' && l.kind !== 'COGS' && l.kind !== 'CLOSING' && !(l.kind === 'ISSUE' && l.orderId))
    .reduce((s, l) => s + l.debitVnd, 0n);
}

/**
 * Profit of a month from its movements (closing transfers excluded). Production overhead still sitting in 154
 * (anything charged to 154 other than material issued for an order) counts as cost of goods sold, as the month-end transfer
 * will move it there.
 */
export function profitOf(lines: Array<OverheadLine>, overheadPending: boolean): ProfitParts {
  const own = lines.filter((l) => l.kind !== 'CLOSING');
  const revenue = netCredit(own, '511');
  const overhead = overheadPending ? overheadOf(own) : 0n;
  const cogs = -netCredit(own, '632') + overhead;
  const selling = -netCredit(own, '6421');
  const admin = -netCredit(own, '6422');
  const otherNet = netCredit(own, '515') + netCredit(own, '711') + netCredit(own, '635') + netCredit(own, '811') + netCredit(own, '821');
  return { revenue, cogs, selling, admin, otherNet, profit: revenue - cogs - selling - admin + otherNet };
}
