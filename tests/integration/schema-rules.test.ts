import { seed } from "../../prisma/seed-data";
import { resetDb, testDb } from "../helpers/db";

const prisma = testDb();
let orgId: string;
let userId: string;

beforeAll(async () => {
  await resetDb(prisma);
  const s = await seed(prisma);
  orgId = s.orgId;
  userId = s.userIds["employee@acme.test"]!;
});

afterAll(() => prisma.$disconnect());

const expense = (overrides: Record<string, unknown> = {}) => ({
  orgId,
  submitterId: userId,
  amountCents: 4200n,
  category: "Meals",
  description: "Team lunch",
  ...overrides,
});

describe("database CHECK constraints", () => {
  it("accepts a valid expense and stores cents exactly", async () => {
    const e = await prisma.expense.create({ data: expense({ amountCents: 9007199254740993n }) });
    expect(e.amountCents).toBe(9007199254740993n);
  });

  it.each([0n, -100n])("rejects an expense of %p cents", async (amountCents) => {
    await expect(prisma.expense.create({ data: expense({ amountCents }) })).rejects.toThrow(
      /Expense_amountCents_positive|check constraint/i,
    );
  });

  it.each(["usd", "US", "DOLLARS"])("rejects currency %p", async (currency) => {
    await expect(prisma.expense.create({ data: expense({ currency }) })).rejects.toThrow(
      /Expense_currency_iso|check constraint/i,
    );
  });
});

describe("idempotency keys are unique per user", () => {
  it("rejects a second row with the same (userId, key)", async () => {
    const row = {
      key: "idem-1",
      userId,
      route: "POST /api/expenses",
      requestHash: "abc",
      responseStatus: 201,
      responseBody: { ok: true },
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await prisma.idempotencyKey.create({ data: row });
    await expect(prisma.idempotencyKey.create({ data: row })).rejects.toThrow(/Unique constraint/i);
  });
});

describe("webhook inbox dedupes by (provider, eventId)", () => {
  it("rejects the same Plaid event twice", async () => {
    const event = { provider: "PLAID" as const, eventId: "evt_1", type: "SYNC_UPDATES_AVAILABLE", payload: {} };
    await prisma.webhookEvent.create({ data: event });
    await expect(prisma.webhookEvent.create({ data: event })).rejects.toThrow(/Unique constraint/i);
  });
});
