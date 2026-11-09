import { seed } from "../../prisma/seed-data";
import { encryptSecret } from "@/lib/crypto";
import { processPendingWebhooks, processWebhookEvent, recordWebhook } from "@/modules/banking";
import { resetDb, testDb } from "../helpers/db";
import { FakePlaid, page, txn } from "../helpers/fakePlaid";

const prisma = testDb();
let orgId: string;
let userId: string;
let plaid: FakePlaid;
let itemId: string;

beforeAll(async () => {
  await resetDb(prisma);
  const s = await seed(prisma);
  orgId = s.orgId;
  userId = s.userIds["employee@acme.test"]!;
});

beforeEach(async () => {
  const plaidItemId = `wh_item_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const item = await prisma.plaidItem.create({
    data: { orgId, userId, plaidItemId, accessTokenEncrypted: encryptSecret("access-x", plaidItemId) },
  });
  itemId = item.id;
  plaid = new FakePlaid();
  plaid.pages.set("", page({ added: [txn(`${plaidItemId}_t1`)], nextCursor: "c1" }));
});

afterAll(async () => {
  await prisma.$disconnect();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

async function body(webhook_type: string, webhook_code: string, extra: Record<string, unknown> = {}) {
  const { plaidItemId } = await prisma.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
  return JSON.stringify({ webhook_type, webhook_code, item_id: plaidItemId, environment: "sandbox", ...extra }, null, 2);
}

describe("webhook inbox", () => {
  it("stores a webhook once; an identical redelivery is a duplicate", async () => {
    const raw = await body("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE");
    const first = await recordWebhook(raw);
    const again = await recordWebhook(raw);
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ id: first.id, duplicate: true });
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({ type: "TRANSACTIONS.SYNC_UPDATES_AVAILABLE", status: "RECEIVED", attempts: 0 });
  });
});

describe("processWebhookEvent", () => {
  it("SYNC_UPDATES_AVAILABLE runs a sync and marks the event processed", async () => {
    const { id } = await recordWebhook(await body("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"));
    expect(await processWebhookEvent(id, { gateway: plaid })).toBe("processed");
    expect(await prisma.transaction.count({ where: { account: { plaidItemId: itemId } } })).toBe(1);
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSED", attempts: 1 });
  });

  it("never processes the same event twice, even when called concurrently", async () => {
    const { id } = await recordWebhook(await body("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"));
    const outcomes = await Promise.all([1, 2, 3].map(() => processWebhookEvent(id, { gateway: plaid })));
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(plaid.syncCalls()).toHaveLength(1);
    expect(await processWebhookEvent(id, { gateway: plaid })).toBe("already-handled");
  });

  it("ITEM ERROR (login required) flags the bank for reconnection", async () => {
    const { id } = await recordWebhook(await body("ITEM", "ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } }));
    await processWebhookEvent(id, { gateway: plaid });
    expect(await prisma.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      status: "LOGIN_REQUIRED",
      lastSyncError: "ITEM_LOGIN_REQUIRED",
    });
  });

  it("ignores webhooks for items we don't have", async () => {
    const raw = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "unknown" }, null, 2);
    const { id } = await recordWebhook(raw);
    expect(await processWebhookEvent(id, { gateway: plaid })).toBe("ignored");
    expect(plaid.calls).toHaveLength(0);
  });

  it("a failed event is retried by the cron job and then succeeds", async () => {
    const { id } = await recordWebhook(await body("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"));
    plaid.failNextSyncWith = new Error("Plaid timed out") as never;
    expect(await processWebhookEvent(id, { gateway: plaid })).toBe("failed");
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", attempts: 1 });

    // The cron job only picks up events older than a minute: age this one.
    await prisma.webhookEvent.update({ where: { id }, data: { receivedAt: new Date(Date.now() - 120_000) } });
    const results = await processPendingWebhooks({ gateway: plaid });
    expect(results.processed).toBeGreaterThanOrEqual(1);
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSED", attempts: 2 });
  });
});
