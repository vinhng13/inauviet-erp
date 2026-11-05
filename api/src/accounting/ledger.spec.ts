import { chargedThrough, lastDay, monthlyCharge, nextMonth, profitOf, splitAmount, valueOf, vatOf, weightedAverage } from './ledger';

describe('accounting helpers', () => {
  it('works with months', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(lastDay('2026-02')).toBe('2026-02-28');
    expect(lastDay('2028-02')).toBe('2028-02-29');
  });

  it('computes VAT and values to the đồng', () => {
    expect(vatOf(1_440_000n, 8)).toBe(115_200n);
    expect(valueOf(0.5, 1_250_000n)).toBe(625_000n);
    expect(valueOf(1.8, 47_000n)).toBe(84_600n);
  });

  it('splits an expense so the parts add up exactly', () => {
    const parts = splitAmount(32_000_001n, [
      { account: '154', percent: 50 },
      { account: '6421', percent: 20 },
      { account: '6422', percent: 30 },
    ]);
    expect(parts.map((p) => p.amount)).toEqual([16_000_001n, 6_400_000n, 9_600_000n]);
    expect(parts.reduce((s, p) => s + p.amount, 0n)).toBe(32_000_001n);
  });

  it('depreciates straight-line, the last month taking the difference', () => {
    expect(monthlyCharge(100_000n, 3, '2026-01', '2025-12')).toBe(0n);
    expect(monthlyCharge(100_000n, 3, '2026-01', '2026-01')).toBe(33_333n);
    expect(monthlyCharge(100_000n, 3, '2026-01', '2026-03')).toBe(33_334n);
    expect(monthlyCharge(100_000n, 3, '2026-01', '2026-04')).toBe(0n);
    expect(chargedThrough(100_000n, 3, '2026-01', '2026-02', false)).toBe(33_333n);
    expect(chargedThrough(100_000n, 3, '2026-01', '2026-03', true)).toBe(100_000n);
  });

  it('prices issues at the monthly weighted average', () => {
    // 400 m² at 22.000 opening + 500 m² bought at 23.000 → 22.556
    expect(weightedAverage(400, 22_000n, 500, 11_500_000n)).toBe(22_556n);
    expect(weightedAverage(0, 0n, 0, 0n)).toBe(0n);
    expect(weightedAverage(0, 0n, 4, 5_000_000n)).toBe(1_250_000n);
  });

  it('works out the month profit, counting 154 overhead as cost until transferred', () => {
    const l = (accountCode: string, debitVnd: bigint, creditVnd: bigint, kind: string, orderId: string | null = kind === 'ISSUE' ? 'o1' : null) => ({ accountCode, debitVnd, creditVnd, kind, orderId });
    const lines = [
      l('131', 1_080_000n, 0n, 'REVENUE'),
      l('511', 0n, 1_000_000n, 'REVENUE'),
      l('33311', 0n, 80_000n, 'REVENUE'),
      l('154', 300_000n, 0n, 'ISSUE'),
      l('632', 300_000n, 0n, 'COGS'),
      l('154', 0n, 300_000n, 'COGS'),
      l('154', 100_000n, 0n, 'EXPENSE'),
      l('6422', 50_000n, 0n, 'EXPENSE'),
    ];
    expect(profitOf(lines, true)).toMatchObject({ revenue: 1_000_000n, cogs: 400_000n, admin: 50_000n, profit: 550_000n });
    expect(profitOf(lines, false).cogs).toBe(300_000n);
    // Material issued without an order (glue, ink for the shop) is overhead too
    expect(profitOf([...lines, l('154', 20_000n, 0n, 'ISSUE', null)], true).cogs).toBe(420_000n);
  });
});
