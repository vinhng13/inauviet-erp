import { DomainError } from '../errors/domain-error';
import { parseDateOnly } from './dates';

/** Parse a "YYYY-MM-DD" request field, turning a bad calendar date into a 400 with a clear code. */
export function dateField(value: string, field: string): Date {
  try {
    return parseDateOnly(value);
  } catch {
    throw DomainError.badRequest('INVALID_DATE', `${field} is not a valid date: ${value}`, { field });
  }
}

export function cleanText(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function optionalBigInt(value: number | null | undefined): bigint | null {
  return value === null || value === undefined ? null : BigInt(value);
}
