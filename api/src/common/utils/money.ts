/** Money is whole đồng. Stored as BigInt in the database, exchanged as JSON numbers. */
export function toVnd(value: bigint | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function lineTotal(quantity: number, unitPriceVnd: bigint | null): bigint | null {
  return unitPriceVnd === null ? null : BigInt(quantity) * unitPriceVnd;
}

export type PaymentStatus = 'NONE' | 'UNPAID' | 'PARTLY_PAID' | 'PAID';

/** NONE when the order has no prices; otherwise compares what was paid with the total. */
export function paymentStatus(totalVnd: bigint | null, paidVnd: bigint): PaymentStatus {
  if (totalVnd === null) return 'NONE';
  if (paidVnd <= 0n) return totalVnd === 0n ? 'PAID' : 'UNPAID';
  return paidVnd >= totalVnd ? 'PAID' : 'PARTLY_PAID';
}
