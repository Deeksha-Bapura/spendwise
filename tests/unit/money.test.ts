import { addCents, formatCents, MoneyParseError, parseToCents } from "@/lib/money";

describe("parseToCents", () => {
  it.each([
    ["75", 7500n],
    ["75.5", 7550n],
    ["75.50", 7550n],
    ["0.01", 1n],
    ["0", 0n],
    ["-12.30", -1230n],
    ["  42.10 ", 4210n],
    ["1,234.56", 123456n],
    ["90071992547409.93", 9007199254740993n], // beyond Number.MAX_SAFE_INTEGER, still exact
  ])("parses %p → %p", (input, expected) => {
    expect(parseToCents(input)).toBe(expected);
  });

  it.each([
    ["75.555", /more than 2 decimal places/],
    ["1e3", /not a valid/],
    ["abc", /not a valid/],
    ["", /not a valid/],
    ["12.", /not a valid/],
    [".5", /not a valid/],
    ["$5", /not a valid/],
    ["1,23", /not a valid/],
  ])("rejects %p", (input, message) => {
    expect(() => parseToCents(input)).toThrow(MoneyParseError);
    expect(() => parseToCents(input)).toThrow(message);
  });

  it("rejects numbers (floats) outright", () => {
    expect(() => parseToCents(75.5 as unknown as string)).toThrow(/must be a string/);
  });
});

describe("formatCents", () => {
  it.each([
    [123456n, "USD", "$1,234.56"],
    [5n, "USD", "$0.05"],
    [0n, "USD", "$0.00"],
    [-1230n, "USD", "-$12.30"],
    [9007199254740993n, "USD", "$90,071,992,547,409.93"],
  ])("formats %p %s → %s", (cents, currency, expected) => {
    expect(formatCents(cents, currency)).toBe(expected);
  });

  it("formats other currencies", () => {
    expect(formatCents(1999n, "EUR", "de-DE")).toMatch(/19,99\s€/);
  });

  it("round-trips with parseToCents", () => {
    for (const s of ["0.01", "75.00", "1234.56"]) {
      expect(formatCents(parseToCents(s)).replace(/[$,]/g, "")).toBe(s);
    }
  });
});

describe("addCents", () => {
  it("adds exactly where floats would drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the bug we're avoiding
    expect(addCents(10n, 20n)).toBe(30n);
  });

  it("throws on non-bigint input", () => {
    expect(() => addCents(10n, 20 as unknown as bigint)).toThrow(TypeError);
  });
});
