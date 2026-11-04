/**
 * Calendar dates (orderDate, dueDate, plannedDate, paidOn) are stored in DATE columns.
 * The API exchanges them as "YYYY-MM-DD" strings; internally they are Date objects at UTC midnight.
 */
export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }
  return d;
}

export function formatDateOnly(value: Date): string;
export function formatDateOnly(value: Date | null | undefined): string | null;
export function formatDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Today's calendar date in the shop's time zone, as "YYYY-MM-DD". */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "YYMM" period used in document codes, based on the shop's time zone. */
export function periodInZone(timeZone: string, now: Date = new Date()): string {
  const ymd = todayInZone(timeZone, now);
  return ymd.slice(2, 4) + ymd.slice(5, 7);
}

export function addDays(ymd: string, days: number): string {
  const d = parseDateOnly(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateOnly(d);
}
