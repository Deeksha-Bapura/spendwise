import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { PlaidGateway } from "./gateway";
import { syncItem } from "./sync";
import { sha256Hex } from "./verify";

/* ───────────── Inbox ───────────── */

export type PlaidWebhookBody = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
  [key: string]: unknown;
};

/**
 * Store a verified webhook before doing anything with it. Plaid webhooks have
 * no event id, so the SHA-256 of the raw body serves as one: an identical
 * redelivery hits the unique (provider, eventId) index and is dropped.
 */
export async function recordWebhook(rawBody: string): Promise<{ id: string; duplicate: boolean }> {
  const body = JSON.parse(rawBody) as PlaidWebhookBody;
  const eventId = sha256Hex(rawBody);
  const created = await db.webhookEvent.createManyAndReturn({
    data: [
      {
        provider: "PLAID",
        eventId,
        type: `${body.webhook_type ?? "UNKNOWN"}.${body.webhook_code ?? "UNKNOWN"}`,
        payload: body as object,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created[0]) return { id: created[0].id, duplicate: false };
  const existing = await db.webhookEvent.findUniqueOrThrow({
    where: { provider_eventId: { provider: "PLAID", eventId } },
    select: { id: true },
  });
  return { id: existing.id, duplicate: true };
}

/* ───────────── Processing ───────────── */

export const MAX_WEBHOOK_ATTEMPTS = 5;

export type ProcessOutcome = "processed" | "ignored" | "failed" | "already-handled";

/**
 * Process one inbox event. Safe to call concurrently and repeatedly:
 * a compare-and-set on `attempts` lets exactly one caller claim each attempt,
 * and processed events are never reprocessed.
 */
export async function processWebhookEvent(
  eventId: string,
  opts: { gateway?: PlaidGateway } = {},
): Promise<ProcessOutcome> {
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "PROCESSED" || event.attempts >= MAX_WEBHOOK_ATTEMPTS) {
    return "already-handled";
  }

  const claimed = await db.webhookEvent.updateMany({
    where: { id: event.id, attempts: event.attempts, status: { not: "PROCESSED" } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "already-handled";

  const body = event.payload as PlaidWebhookBody;
  const log = logger.child({ webhookEventId: event.id, type: event.type });

  try {
    const outcome = await handle(body, opts.gateway);
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    log.info({ outcome }, "webhook processed");
    return outcome;
  } catch (err) {
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "FAILED" } });
    log.error({ err: err instanceof Error ? err.message : err }, "webhook processing failed");
    return "failed";
  }
}

async function handle(body: PlaidWebhookBody, gateway?: PlaidGateway): Promise<"processed" | "ignored"> {
  const item = body.item_id
    ? await db.plaidItem.findUnique({ where: { plaidItemId: body.item_id }, select: { id: true } })
    : null;
  if (!item) return "ignored"; // not ours (or already removed)

  const key = `${body.webhook_type}.${body.webhook_code}`;
  switch (key) {
    case "TRANSACTIONS.SYNC_UPDATES_AVAILABLE":
      await syncItem(item.id, { gateway });
      return "processed";

    case "ITEM.ERROR":
    case "ITEM.PENDING_EXPIRATION":
    case "ITEM.PENDING_DISCONNECT":
      await db.plaidItem.update({
        where: { id: item.id },
        data: { status: "LOGIN_REQUIRED", lastSyncError: body.error?.error_code ?? body.webhook_code ?? null },
      });
      return "processed";

    case "ITEM.LOGIN_REPAIRED":
      await db.plaidItem.update({ where: { id: item.id }, data: { status: "ACTIVE", lastSyncError: null } });
      return "processed";

    case "ITEM.USER_PERMISSION_REVOKED":
      await db.plaidItem.update({ where: { id: item.id }, data: { status: "REVOKED" } });
      return "processed";

    default:
      return "ignored";
  }
}

/** Retry inbox events that failed or were never processed (called by cron). */
export async function processPendingWebhooks(opts: { limit?: number; gateway?: PlaidGateway } = {}) {
  const staleBefore = new Date(Date.now() - 60_000); // give in-flight `after()` work a minute
  const pending = await db.webhookEvent.findMany({
    where: {
      status: { in: ["RECEIVED", "FAILED"] },
      attempts: { lt: MAX_WEBHOOK_ATTEMPTS },
      receivedAt: { lt: staleBefore },
    },
    orderBy: { receivedAt: "asc" },
    take: opts.limit ?? 25,
    select: { id: true },
  });
  const results: Record<ProcessOutcome, number> = { processed: 0, ignored: 0, failed: 0, "already-handled": 0 };
  for (const { id } of pending) results[await processWebhookEvent(id, { gateway: opts.gateway })]++;
  return results;
}
