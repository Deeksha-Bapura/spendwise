import { plaidAmountToCents, plaidDateToUtc } from "@/modules/banking/amounts";

describe("plaidAmountToCents", () => {
  it.each([
    [12.34, 1234n],
    [0.1, 10n],
    [-4.5, -450n], // negative = money into the account (Plaid convention)
    [1000000.99, 100000099n],
    [0.07, 7n], // 0.07 * 100 = 7.000000000000001 in floats; we still get exactly 7
  ])("%p → %p cents", (amount, cents) => {
    expect(plaidAmountToCents(amount)).toBe(cents);
  });

  it("refuses sub-cent amounts instead of rounding money", () => {
    expect(() => plaidAmountToCents(1.005)).toThrow(/more than 2 decimal places/);
  });

  it("refuses NaN and Infinity", () => {
    expect(() => plaidAmountToCents(Number.NaN)).toThrow(RangeError);
    expect(() => plaidAmountToCents(Infinity)).toThrow(RangeError);
  });
});

describe("plaidDateToUtc", () => {
  it("treats Plaid dates as UTC midnight", () => {
    expect(plaidDateToUtc("2026-11-09").toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("rejects anything else", () => {
    expect(() => plaidDateToUtc("11/09/2026")).toThrow(RangeError);
  });
});
