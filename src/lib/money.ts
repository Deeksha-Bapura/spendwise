/**
 * Money is always integer cents (bigint). Never use Number math on money:
 * 0.1 + 0.2 !== 0.3 in floating point, and Number loses precision past 2^53.
 */

export class MoneyParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid amount "${input}": ${reason}`);
    this.name = "MoneyParseError";
  }
}

const AMOUNT_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse a user-entered decimal string into cents.
 * Accepts "75", "75.5", "75.50", "-12.30", "1,234.56".
 * Rejects more than 2 decimals, exponents ("1e3"), and anything non-numeric.
 */
export function parseToCents(input: string): bigint {
  if (typeof input !== "string") {
    throw new MoneyParseError(String(input), "must be a string, not a number");
  }
  const trimmed = input.trim();
  const normalized = trimmed.replace(/,(?=\d{3}(\D|$))/g, "");
  const match = AMOUNT_RE.exec(normalized);
  if (!match) {
    if (/^-?\d+\.\d{3,}$/.test(normalized)) {
      throw new MoneyParseError(input, "more than 2 decimal places");
    }
    throw new MoneyParseError(input, "not a valid decimal amount");
  }
  const [, sign, whole, frac = ""] = match;
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return sign ? -cents : cents;
}

/** Format cents for display, e.g. 123456n, "USD" → "$1,234.56". */
export function formatCents(cents: bigint, currency = "USD", locale = "en-US"): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  // Pass a decimal *string* to Intl so it formats exactly, with no float conversion.
  const decimal = `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    decimal as Intl.StringNumericLiteral,
  );
}

/** Add amounts. Throws if any argument isn't a bigint. */
export function addCents(...amounts: bigint[]): bigint {
  return amounts.reduce((sum, a) => {
    if (typeof a !== "bigint") throw new TypeError("addCents only accepts bigint cents");
    return sum + a;
  }, 0n);
}
