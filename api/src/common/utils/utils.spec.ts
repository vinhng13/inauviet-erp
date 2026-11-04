import { addDays, parseDateOnly, periodInZone, todayInZone } from './dates';
import { paymentStatus } from './money';
import { normalizePhone } from './phone';
import { toSearchText } from './vn-text';

describe('toSearchText', () => {
  it('removes Vietnamese diacritics and lowercases', () => {
    expect(toSearchText('Nguyễn Văn Á', 'Công ty Đại Phát', '0903123456')).toBe('nguyen van a cong ty dai phat 0903123456');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['0903 123 456', '0903123456'],
    ['0903.123.456', '0903123456'],
    ['+84 903 123 456', '0903123456'],
    ['84903123456', '0903123456'],
    ['028 3823 4567', '02838234567'],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(['12345', 'abc', '0903'])('rejects %s', (input) => expect(normalizePhone(input)).toBeNull());
});

describe('dates', () => {
  it('uses the shop time zone for "today" and the code period', () => {
    const lateEveningUtc = new Date('2026-10-31T18:30:00Z'); // 01:30 on 1 Nov in Vietnam
    expect(todayInZone('Asia/Ho_Chi_Minh', lateEveningUtc)).toBe('2026-11-01');
    expect(periodInZone('Asia/Ho_Chi_Minh', lateEveningUtc)).toBe('2611');
  });

  it('rejects impossible dates', () => {
    expect(() => parseDateOnly('2026-02-30')).toThrow();
    expect(addDays('2026-10-29', 7)).toBe('2026-11-05');
  });
});

describe('paymentStatus', () => {
  it('reports by comparing paid with total', () => {
    expect(paymentStatus(null, 0n)).toBe('NONE');
    expect(paymentStatus(12_000_000n, 0n)).toBe('UNPAID');
    expect(paymentStatus(12_000_000n, 3_000_000n)).toBe('PARTLY_PAID');
    expect(paymentStatus(12_000_000n, 12_000_000n)).toBe('PAID');
  });
});
