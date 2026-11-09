import { seed } from "../../prisma/seed-data";
import { encryptSecret } from "@/lib/crypto";
import { PlaidApiError, syncItem } from "@/modules/banking";
import { resetDb, testDb } from "../helpers/db";
import { FakePlaid, page, txn } from "../helpers/fakePlaid";

const prisma = testDb();
let orgId: string;
let userId: string;

beforeAll(async () => {
  await resetDb(prisma);
  const s = await seed(prisma);
  orgId = s.orgId;
  userId = s.userIds["employee@acme.test"]!;
});

afterAll(async () => {
  await prisma.$disconnect();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

let n = 0;
async function newItem() {
  const plaidItemId = `item_test_${++n}`;
  return prisma.plaidItem.create({
    data: { orgId, userId, plaidItemId, accessTokenEncrypted: encryptSecret("access-sandbox-x", plaidItemId) },
  });
}

const txnsFor = (itemId: string) =>
  prisma.transaction.findMany({
    where: { account: { plaidItemId: itemId } },
    orderBy: { plaidTransactionId: "asc" },
  });

describe("syncItem", () => {
  it("pulls every page before writing, then stores accounts and transactions", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({ added: [txn("t1"), txn("t2", { amount: 640.5, merchantName: "Delta" })], hasMore: true, nextCursor: "c1" }));
    plaid.pages.set("c1", page({ added: [txn("t3", { amount: -25, pending: true })], nextCursor: "c2" }));

    const result = await syncItem(item.id, { gateway: plaid });

    expect(result).toEqual({ status: "synced", upserted: 3, removed: 0, skipped: 0 });
    expect(plaid.syncCalls()).toEqual([null, "c1"]);
    const rows = await txnsFor(item.id);
    expect(rows.map((r) => [r.plaidTransactionId, r.amountCents])).toEqual([
      ["t1", 1234n],
      ["t2", 64050n],
      ["t3", -2500n],
    ]);
    expect(rows[0]!.plaidCategory).toBe("TRANSPORTATION");
    const saved = await prisma.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(saved.syncCursor).toBe("c2");
    expect(saved.lastSyncedAt).not.toBeNull();
  });

  it("is idempotent: replaying the same pages never duplicates transactions", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({ added: [txn("r1"), txn("r2")], nextCursor: "c1" }));
    await syncItem(item.id, { gateway: plaid });

    // Simulate a lost cursor (e.g. restored backup): Plaid replays everything.
    await prisma.plaidItem.update({ where: { id: item.id }, data: { syncCursor: null } });
    await syncItem(item.id, { gateway: plaid });
    await syncItem(item.id, { gateway: plaid }); // and once more with nothing new

    expect(await txnsFor(item.id)).toHaveLength(2);
  });

  it("applies modifications and soft-deletes removals", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({ added: [txn("m1", { pending: true }), txn("m2")], nextCursor: "c1" }));
    await syncItem(item.id, { gateway: plaid });

    plaid.pages.set("c1", page({ modified: [txn("m1", { pending: false, amount: 15 })], removed: ["m2"], nextCursor: "c2" }));
    const result = await syncItem(item.id, { gateway: plaid });

    expect(result).toMatchObject({ status: "synced", upserted: 1, removed: 1 });
    const [m1, m2] = await txnsFor(item.id);
    expect(m1).toMatchObject({ pending: false, amountCents: 1500n, removedAt: null });
    expect(m2!.removedAt).not.toBeNull(); // kept for history, hidden from lists
  });

  it("a removal on a later page cancels an add from an earlier page", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({ added: [txn("x1"), txn("x2")], hasMore: true, nextCursor: "c1" }));
    plaid.pages.set("c1", page({ removed: ["x1"], nextCursor: "c2" }));
    await syncItem(item.id, { gateway: plaid });
    expect((await txnsFor(item.id)).map((t) => t.plaidTransactionId)).toEqual(["x2"]);
  });

  it("restarts from the original cursor when Plaid's data changes mid-pagination", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({ added: [txn("p1")], hasMore: true, nextCursor: "c1" }));
    plaid.pages.set("c1", page({ added: [txn("p2")], nextCursor: "c2" }));
    // Fail on the 2nd call (the "c1" page) once.
    const original = plaid.syncTransactions.bind(plaid);
    let calls = 0;
    plaid.syncTransactions = async (input) => {
      if (++calls === 2) throw new PlaidApiError("changed", "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", 400);
      return original(input);
    };

    await syncItem(item.id, { gateway: plaid });
    // Page 1, then (the c1 call fails before being recorded) back to page 1, then c1.
    // Restarting from the ORIGINAL cursor, not retrying c1, is what Plaid requires.
    expect(plaid.syncCalls()).toEqual([null, null, "c1"]);
    expect(calls).toBe(4);
    expect(await txnsFor(item.id)).toHaveLength(2);
  });

  it("two concurrent syncs: one commits, the other is superseded, no duplicates", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.syncDelayMs = 50; // both read the same starting cursor before either writes
    plaid.pages.set("", page({ added: [txn("k1"), txn("k2"), txn("k3")], nextCursor: "c1" }));

    const results = await Promise.all([syncItem(item.id, { gateway: plaid }), syncItem(item.id, { gateway: plaid })]);

    expect(results.map((r) => r.status).sort()).toEqual(["superseded", "synced"]);
    expect(await txnsFor(item.id)).toHaveLength(3);
    const audits = await prisma.auditLog.count({ where: { action: "bank.synced", entityId: item.id } });
    expect(audits).toBe(1); // the loser's audit row rolled back with it
  });

  it("marks the item LOGIN_REQUIRED when the bank needs re-authentication", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.failNextSyncWith = new PlaidApiError("login", "ITEM_LOGIN_REQUIRED", 400);

    await expect(syncItem(item.id, { gateway: plaid })).rejects.toThrow(PlaidApiError);
    const saved = await prisma.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(saved).toMatchObject({ status: "LOGIN_REQUIRED", lastSyncError: "ITEM_LOGIN_REQUIRED", syncCursor: null });
  });

  it("skips zero-amount and unofficial-currency transactions instead of failing the sync", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({
      added: [txn("ok"), txn("zero", { amount: 0 }), txn("btc", { isoCurrencyCode: null, unofficialCurrencyCode: "BTC" })],
      nextCursor: "c1",
    }));
    const result = await syncItem(item.id, { gateway: plaid });
    expect(result).toMatchObject({ upserted: 1, skipped: 2 });
  });

  it("never calls Plaid for seeded demo items", async () => {
    const demo = await prisma.plaidItem.findFirstOrThrow({ where: { plaidItemId: { startsWith: "demo_" } } });
    const plaid = new FakePlaid();
    expect(await syncItem(demo.id, { gateway: plaid })).toMatchObject({ status: "skipped" });
    expect(plaid.calls).toHaveLength(0);
  });

  it("writes one audit entry per sync with the counts", async () => {
    const item = await newItem();
    const plaid = new FakePlaid();
    plaid.pages.set("", page({ added: [txn("a1")], nextCursor: "c1" }));
    await syncItem(item.id, { gateway: plaid, actorId: userId, requestId: "req-1" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "bank.synced", entityId: item.id } });
    expect(audit).toMatchObject({ actorId: userId, requestId: "req-1" });
    expect(audit.after).toMatchObject({ upserted: 1, removed: 0, pages: 1 });
  });
});
