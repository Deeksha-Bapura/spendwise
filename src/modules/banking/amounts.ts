import { parseToCents } from "@/lib/money";

/**
 * Plaid sends amounts as JSON numbers (e.g. 12.34). Convert to integer cents
 * at the boundary, and refuse anything with sub-cent precision rather than
 * silently rounding money.
 */
export function plaidAmountToCents(amount: number): bigint {
  if (!Number.isFinite(amount)) throw new RangeError(`Invalid Plaid amount: ${amount}`);
  const fixed = amount.toFixed(2);
  if (Math.abs(Number(fixed) - amount) > 1e-9) {
    throw new RangeError(`Plaid amount has more than 2 decimal places: ${amount}`);
  }
  return parseToCents(fixed);
}

/** Plaid dates are "YYYY-MM-DD" with no time zone; store them as UTC midnight. */
export function plaidDateToUtc(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Invalid Plaid date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}
