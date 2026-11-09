import "server-only";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit";
import { getPlaidGateway, type PlaidGateway } from "./gateway";
import { syncItem, type SyncResult } from "./sync";

type Owner = { id: string; orgId: string };

/**
 * Exchange Link's public token for an access token, store the item with the
 * token encrypted, then run the first sync (which also turns on Plaid's
 * SYNC_UPDATES_AVAILABLE webhooks for the item).
 *
 * Re-linking the same bank returns the same item (upsert by Plaid's item id).
 */
export async function connectItem(input: {
  user: Owner;
  publicToken: string;
  institutionName: string | null;
  gateway?: PlaidGateway;
  requestId?: string | null;
}) {
  const gateway = input.gateway ?? getPlaidGateway();
  const { accessToken, itemId } = await gateway.exchangePublicToken(input.publicToken);

  const existing = await db.plaidItem.findUnique({ where: { plaidItemId: itemId }, select: { userId: true } });
  if (existing && existing.userId !== input.user.id) {
    throw new HttpError(409, "This bank connection belongs to another user");
  }

  const item = await db.$transaction(async (tx) => {
    const saved = await tx.plaidItem.upsert({
      where: { plaidItemId: itemId },
      update: {
        accessTokenEncrypted: encryptSecret(accessToken, itemId),
        institutionName: input.institutionName,
        status: "ACTIVE",
      },
      create: {
        orgId: input.user.orgId,
        userId: input.user.id,
        plaidItemId: itemId,
        accessTokenEncrypted: encryptSecret(accessToken, itemId),
        institutionName: input.institutionName,
      },
      select: { id: true, institutionName: true, createdAt: true, updatedAt: true },
    });
    await recordAudit(tx, {
      orgId: input.user.orgId,
      actorId: input.user.id,
      action: existing ? "bank.reconnected" : "bank.connected",
      entity: { type: "PlaidItem", id: saved.id },
      after: { institutionName: saved.institutionName },
      requestId: input.requestId ?? null,
    });
    return saved;
  });

  // The first sync often returns nothing while Plaid is still fetching
  // history; SYNC_UPDATES_AVAILABLE fires when data is ready. A failure here
  // shouldn't undo the connection, so log it and let a later sync catch up.
  let firstSync: SyncResult | { status: "error"; message: string };
  try {
    firstSync = await syncItem(item.id, { gateway, actorId: input.user.id, requestId: input.requestId });
  } catch (err) {
    logger.warn({ itemId: item.id, err: err instanceof Error ? err.message : err }, "initial sync failed");
    firstSync = { status: "error", message: "Initial sync failed; try Sync now" };
  }

  return { itemId: item.id, institutionName: item.institutionName, firstSync };
}
