import { seed } from "../../prisma/seed-data";
import { HttpError } from "@/lib/http";
import { withIdempotency } from "@/modules/events";
import { resetDb, testDb } from "../helpers/db";

const prisma = testDb();
let userId: string;

beforeAll(async () => {
  await resetDb(prisma);
  userId = (await seed(prisma)).userIds["employee@acme.test"]!;
});

afterAll(async () => {
  await prisma.$disconnect();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

const req = (key: string | null, requestBody: unknown = { publicToken: "pt-1" }) => ({
  userId,
  key,
  route: "POST /api/plaid/exchange",
  requestBody,
});

describe("withIdempotency", () => {
  it("runs the handler once; a retry with the same key replays the stored response", async () => {
    const handler = jest.fn(async () => ({ status: 201, body: { itemId: "item_1" } }));
    const first = await withIdempotency(req("key-aaaa-1"), handler);
    const retry = await withIdempotency(req("key-aaaa-1"), handler);
    expect(first).toEqual({ status: 201, body: { itemId: "item_1" }, replayed: false });
    expect(retry).toEqual({ status: 201, body: { itemId: "item_1" }, replayed: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("concurrent requests with the same key run the handler exactly once", async () => {
    let runs = 0;
    const handler = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 100));
      return { status: 201, body: { run: runs } };
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => withIdempotency(req("key-concurrent"), handler)));
    expect(runs).toBe(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body)))).toEqual(new Set([JSON.stringify({ run: 1 })]));
    expect(results.filter((r) => r.replayed)).toHaveLength(4);
  });

  it("rejects reusing a key for a different request body (422)", async () => {
    await withIdempotency(req("key-bbbb-1", { publicToken: "A" }), async () => ({ status: 201, body: {} }));
    await expect(
      withIdempotency(req("key-bbbb-1", { publicToken: "B" }), async () => ({ status: 201, body: {} })),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("does not store failures, so the client can retry", async () => {
    const failing = jest.fn(async () => ({ status: 502, body: { error: "Plaid down" } }));
    const ok = jest.fn(async () => ({ status: 201, body: { ok: true } }));
    await withIdempotency(req("key-cccc-1"), failing);
    const retry = await withIdempotency(req("key-cccc-1"), ok);
    expect(retry).toMatchObject({ status: 201, replayed: false });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("rolls back if the handler throws, leaving no stored key", async () => {
    await expect(
      withIdempotency(req("key-dddd-1"), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.idempotencyKey.count({ where: { key: "key-dddd-1" } })).toBe(0);
  });

  it.each([null, "short", "has spaces in it"])("requires a well-formed key (%p)", async (key) => {
    await expect(withIdempotency(req(key), async () => ({ status: 200, body: {} }))).rejects.toBeInstanceOf(HttpError);
  });

  it("keys are per user: the same key from another user is independent", async () => {
    const other = (await prisma.user.findUniqueOrThrow({ where: { email: "manager@acme.test" } })).id;
    const handler = jest.fn(async () => ({ status: 201, body: {} }));
    await withIdempotency(req("key-shared-1"), handler);
    await withIdempotency({ ...req("key-shared-1"), userId: other }, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
