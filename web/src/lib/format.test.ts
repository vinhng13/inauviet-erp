import { describe, expect, it } from 'vitest';
import { formatDate, formatVnd, vndInputProps } from './format';

describe('format', () => {
  it('formats đồng with dots', () => {
    expect(formatVnd(12_000_000)).toBe('12.000.000 đ');
    expect(formatVnd(null)).toBe('—');
  });
  it('formats dates as DD/MM/YYYY', () => {
    expect(formatDate('2026-11-02')).toBe('02/11/2026');
  });
  it('round-trips money input', () => {
    expect(vndInputProps.formatter(2500000)).toBe('2.500.000');
    expect(vndInputProps.parser('2.500.000')).toBe(2500000);
  });
});
