import { DEMO_TRANSACTIONS_PER_USER, seed } from "../../prisma/seed-data";
import { decryptSecret } from "@/lib/crypto";
import { connectItem, listTransactions } from "@/modules/banking";
import type { Actor } from "@/modules/auth";
import { resetDb, testDb } from "../helpers/db";
import { FakePlaid, page, txn } from "../helpers/fakePlaid";

const prisma = testDb();
beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

async function actor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, orgId: u.orgId, teamId: u.teamId, role: u.role };
}

async function everything(a: Actor) {
  const rows = [];
  let cursor: string | null = null;
  do {
    const p = await listTransactions(a, { cursor, limit: 7 });
    rows.push(...p.rows);
    cursor = p.nextCursor;
  } while (cursor);
  return rows;
}

describe("connectItem", () => {
  it("exchanges the token, stores it encrypted, audits, and runs the first sync", async () => {
    const plaid = new FakePlaid();
    plaid.exchangeMap.set("public-1", { accessToken: "access-sandbox-secret", itemId: "item_connect_1" });
    plaid.pages.set("", page({ added: [txn("first-1")], nextCursor: "c1" }));
    const emma = await actor("employee@acme.test");

    const result = await connectItem({ user: emma, publicToken: "public-1", institutionName: "First Platypus Bank", gateway: plaid });

    expect(result.firstSync).toMatchObject({ status: "synced", upserted: 1 });
    const item = await prisma.plaidItem.findUniqueOrThrow({ where: { plaidItemId: "item_connect_1" } });
    expect(item.accessTokenEncrypted).not.toContain("access-sandbox-secret");
    expect(decryptSecret(item.accessTokenEncrypted, "item_connect_1")).toBe("access-sandbox-secret");
    expect(await prisma.auditLog.count({ where: { action: "bank.connected", entityId: item.id } })).toBe(1);
  });

  it("refuses to attach someone else's bank connection", async () => {
    const plaid = new FakePlaid();
    plaid.exchangeMap.set("public-2", { accessToken: "a", itemId: "item_connect_1" }); // Emma's item
    await expect(
      connectItem({ user: await actor("sam@acme.test"), publicToken: "public-2", institutionName: null, gateway: plaid }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("listTransactions: who sees what", () => {
  it("an employee sees only their own transactions", async () => {
    const emma = await actor("employee@acme.test");
    const rows = await everything(emma);
    expect(new Set(rows.map((r) => r.owner.name))).toEqual(new Set(["Emma Employee"]));
  });

  it("a manager sees their team (Emma, Eli, themselves) but not Sales", async () => {
    const rows = await everything(await actor("manager@acme.test"));
    const owners = new Set(rows.map((r) => r.owner.name));
    expect(owners).toEqual(new Set(["Emma Employee", "Eli Chen", "Marcus Manager"]));
    expect(owners.has("Sam Patel")).toBe(false);
  });

  it("a finance admin sees the whole org", async () => {
    const rows = await everything(await actor("finance@acme.test"));
    expect(new Set(rows.map((r) => r.owner.name))).toEqual(
      new Set(["Emma Employee", "Eli Chen", "Marcus Manager", "Sam Patel"]),
    );
  });

  it("keyset pagination returns every row exactly once, newest first", async () => {
    const rows = await everything(await actor("finance@acme.test"));
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.length).toBe(4 * DEMO_TRANSACTIONS_PER_USER + 1); // + the one synced above
    const dates = rows.map((r) => r.postedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("hides removed transactions", async () => {
    const emma = await actor("employee@acme.test");
    const before = (await everything(emma)).length;
    await prisma.transaction.update({ where: { plaidTransactionId: "first-1" }, data: { removedAt: new Date() } });
    expect((await everything(emma)).length).toBe(before - 1);
  });

  it("serializes cents as strings (exact, JSON-safe)", async () => {
    const [row] = (await listTransactions(await actor("employee@acme.test"), { limit: 1 })).rows;
    expect(typeof row!.amountCents).toBe("string");
    expect(BigInt(row!.amountCents)).toBeGreaterThan(0n);
  });

  it("ignores a forged cursor instead of erroring", async () => {
    const p = await listTransactions(await actor("employee@acme.test"), { cursor: "not-base64-json", limit: 5 });
    expect(p.rows).toHaveLength(5);
  });

  it("never leaks another org's data", async () => {
    const other = await prisma.organization.create({ data: { name: "Globex", slug: `globex-${Date.now()}` } });
    const rows = await everything({ ...(await actor("finance@acme.test")), orgId: other.id });
    expect(rows).toHaveLength(0);
  });
});
