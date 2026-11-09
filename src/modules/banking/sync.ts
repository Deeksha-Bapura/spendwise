import "server-only";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit";
import { plaidAmountToCents, plaidDateToUtc } from "./amounts";
import {
  getPlaidGateway,
  PlaidApiError,
  type GatewayAccount,
  type GatewayTransaction,
  type PlaidGateway,
} from "./gateway";

export const DEMO_ITEM_PREFIX = "demo_";
const MAX_PAGES = 50; // 500 per page → up to 25k updates per sync
const MAX_RESTARTS = 3;

export type SyncResult =
  | { status: "synced"; upserted: number; removed: number; skipped: number }
  | { status: "superseded" } // another sync for this item committed first
  | { status: "skipped"; reason: string };

/** Plaid error codes that mean the user has to reconnect the bank. */
const LOGIN_REQUIRED_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "ACCESS_NOT_GRANTED"]);

class CursorConflict extends Error {}

type Collected = {
  accounts: Map<string, GatewayAccount>;
  upserts: Map<string, GatewayTransaction>;
  removed: Set<string>;
  nextCursor: string;
  pages: number;
};

/**
 * Fetch every page of updates since `startCursor` before writing anything,
 * as Plaid requires. If a page fails mid-loop (e.g. the data changed while
 * paginating), restart from `startCursor`, not from the failed page.
 */
async function collectUpdates(
  gateway: PlaidGateway,
  accessToken: string,
  startCursor: string | null,
): Promise<Collected> {
  for (let attempt = 0; ; attempt++) {
    const out: Collected = {
      accounts: new Map(),
      upserts: new Map(),
      removed: new Set(),
      nextCursor: startCursor ?? "",
      pages: 0,
    };
    let cursor = startCursor;
    try {
      while (true) {
        const page = await gateway.syncTransactions({ accessToken, cursor });
        out.pages++;
        for (const a of page.accounts) out.accounts.set(a.plaidAccountId, a);
        // Pages are in order, so a later add/modify overrides an earlier one,
        // and a later removal cancels an earlier add.
        for (const t of [...page.added, ...page.modified]) {
          out.removed.delete(t.plaidTransactionId);
          out.upserts.set(t.plaidTransactionId, t);
        }
        for (const id of page.removed) {
          out.upserts.delete(id);
          out.removed.add(id);
        }
        out.nextCursor = page.nextCursor;
        cursor = page.nextCursor;
        if (!page.hasMore) return out;
        if (out.pages >= MAX_PAGES) throw new Error(`Sync exceeded ${MAX_PAGES} pages`);
      }
    } catch (err) {
      const restartable = err instanceof PlaidApiError && err.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
      if (restartable && attempt < MAX_RESTARTS) {
        logger.warn({ attempt }, "Plaid data changed during pagination; restarting sync loop");
        continue;
      }
      throw err;
    }
  }
}

/**
 * Pull new, changed and removed transactions for one Plaid item and apply
 * them in a single database transaction.
 *
 * Safe to call any number of times, concurrently or not:
 *  - transactions are upserted by Plaid's transaction id, so replays never duplicate;
 *  - the cursor is advanced with compare-and-set, so if two syncs race,
 *    only the first commits and the other rolls back as "superseded".
 */
export async function syncItem(
  itemId: string,
  opts: { gateway?: PlaidGateway; actorId?: string | null; requestId?: string | null } = {},
): Promise<SyncResult> {
  const item = await db.plaidItem.findUnique({ where: { id: itemId } });
  if (!item) return { status: "skipped", reason: "item not found" };
  if (item.plaidItemId.startsWith(DEMO_ITEM_PREFIX)) {
    return { status: "skipped", reason: "demo item (seeded data, not connected to Plaid)" };
  }
  if (item.status === "REVOKED") return { status: "skipped", reason: "item revoked" };

  const gateway = opts.gateway ?? getPlaidGateway();
  const accessToken = decryptSecret(item.accessTokenEncrypted, item.plaidItemId);
  const startCursor = item.syncCursor;

  let updates: Collected;
  try {
    updates = await collectUpdates(gateway, accessToken, startCursor);
  } catch (err) {
    const code = err instanceof PlaidApiError ? err.code : null;
    await db.plaidItem.update({
      where: { id: item.id },
      data: {
        lastSyncError: code ?? (err instanceof Error ? err.message : "unknown error"),
        ...(code && LOGIN_REQUIRED_CODES.has(code) ? { status: "LOGIN_REQUIRED" } : {}),
      },
    });
    throw err;
  }

  let skipped = 0;
  try {
    const counts = await db.$transaction(
      async (tx) => {
        // 1. Advance the cursor only if nobody else has since we read it.
        const advanced = await tx.plaidItem.updateMany({
          where: { id: item.id, syncCursor: startCursor },
          data: {
            syncCursor: updates.nextCursor,
            lastSyncedAt: new Date(),
            lastSyncError: null,
            status: "ACTIVE",
          },
        });
        if (advanced.count === 0) throw new CursorConflict();

        // 2. Accounts first, so every transaction has one to point at.
        const accountIds = new Map<string, string>();
        for (const a of updates.accounts.values()) {
          const row = await tx.bankAccount.upsert({
            where: { plaidAccountId: a.plaidAccountId },
            update: { name: a.name, mask: a.mask, type: a.type },
            create: {
              orgId: item.orgId,
              plaidItemId: item.id,
              plaidAccountId: a.plaidAccountId,
              name: a.name,
              mask: a.mask,
              type: a.type,
            },
            select: { id: true },
          });
          accountIds.set(a.plaidAccountId, row.id);
        }
        const missing = [...updates.upserts.values()]
          .map((t) => t.plaidAccountId)
          .filter((id) => !accountIds.has(id));
        if (missing.length) {
          const known = await tx.bankAccount.findMany({
            where: { plaidAccountId: { in: [...new Set(missing)] }, plaidItemId: item.id },
            select: { id: true, plaidAccountId: true },
          });
          for (const k of known) accountIds.set(k.plaidAccountId, k.id);
        }

        // 3. Upsert added + modified transactions.
        let upserted = 0;
        for (const t of updates.upserts.values()) {
          const accountId = accountIds.get(t.plaidAccountId);
          const currency = t.isoCurrencyCode ?? (t.unofficialCurrencyCode ? null : "USD");
          if (!accountId || !currency || t.amount === 0) {
            skipped++;
            logger.warn(
              { plaidTransactionId: t.plaidTransactionId, hasAccount: !!accountId, currency, zero: t.amount === 0 },
              "skipping transaction",
            );
            continue;
          }
          const data = {
            accountId,
            amountCents: plaidAmountToCents(t.amount),
            currency,
            merchantName: t.merchantName,
            rawDescription: t.name,
            postedAt: plaidDateToUtc(t.date),
            pending: t.pending,
            plaidCategory: t.category,
            removedAt: null,
          };
          await tx.transaction.upsert({
            where: { plaidTransactionId: t.plaidTransactionId },
            update: data,
            create: { ...data, orgId: item.orgId, plaidTransactionId: t.plaidTransactionId },
          });
          upserted++;
        }

        // 4. Soft-delete removals. Finance data is never hard-deleted:
        //    an expense may already point at the transaction.
        const removed = updates.removed.size
          ? await tx.transaction.updateMany({
              where: { plaidTransactionId: { in: [...updates.removed] }, orgId: item.orgId, removedAt: null },
              data: { removedAt: new Date() },
            })
          : { count: 0 };

        await recordAudit(tx, {
          orgId: item.orgId,
          actorId: opts.actorId ?? null,
          action: "bank.synced",
          entity: { type: "PlaidItem", id: item.id },
          after: { upserted, removed: removed.count, skipped, pages: updates.pages },
          requestId: opts.requestId ?? null,
        });
        return { upserted, removed: removed.count };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return { status: "synced", upserted: counts.upserted, removed: counts.removed, skipped };
  } catch (err) {
    if (err instanceof CursorConflict) {
      logger.info({ itemId: item.id }, "sync superseded by a concurrent sync");
      return { status: "superseded" };
    }
    throw err;
  }
}
