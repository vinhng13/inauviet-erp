/**
 * Normalize a Vietnamese phone number to the 0xxxxxxxxx form.
 * Accepts spaces, dots, dashes and the +84 / 84 country prefix.
 * Returns null when the result is not 9–11 digits starting with 0.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84') && digits.length >= 11) digits = '0' + digits.slice(2);
  digits = digits.replace(/\+/g, '');
  return /^0\d{8,10}$/.test(digits) ? digits : null;
}
