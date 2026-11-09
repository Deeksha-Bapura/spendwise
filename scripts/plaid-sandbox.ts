/**
 * Sandbox helpers for testing the Plaid integration end to end.
 *
 *   pnpm plaid:sandbox list                      # your connected (non-demo) banks
 *   pnpm plaid:sandbox add-transactions <id>     # create 3 custom transactions at Plaid
 *   pnpm plaid:sandbox fire-webhook <id>         # make Plaid send SYNC_UPDATES_AVAILABLE
 *
 * <id> is the Spendwise PlaidItem id shown by `list`. Sandbox only.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PlaidClient, PlaidEnvironment } from "plaid";
import { PrismaClient } from "../src/generated/prisma/client";
import { decryptSecret } from "../src/lib/crypto";

async function main() {
  const [command, itemId] = process.argv.slice(2);
  if (process.env.PLAID_ENV && process.env.PLAID_ENV !== "sandbox") throw new Error("Sandbox only");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const plaid = new PlaidClient({
    environment: PlaidEnvironment.Sandbox,
    clientId: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
  });

  try {
    if (command === "list") {
      const items = await prisma.plaidItem.findMany({
        where: { NOT: { plaidItemId: { startsWith: "demo_" } } },
        select: { id: true, institutionName: true, status: true, lastSyncedAt: true, user: { select: { email: true } } },
      });
      console.table(items.map((i) => ({ id: i.id, bank: i.institutionName, owner: i.user.email, status: i.status, lastSyncedAt: i.lastSyncedAt })));
      return;
    }

    if (!itemId) throw new Error("Pass the item id (see: pnpm plaid:sandbox list)");
    const item = await prisma.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
    const accessToken = decryptSecret(item.accessTokenEncrypted, item.plaidItemId);

    if (command === "add-transactions") {
      const today = new Date().toISOString().slice(0, 10);
      await plaid.sandbox.createTransactions({
        access_token: accessToken,
        transactions: [
          { date_transacted: today, date_posted: today, amount: 86.4, description: "THE CAPITAL GRILLE", iso_currency_code: "USD" },
          { date_transacted: today, date_posted: today, amount: 23.15, description: "UBER *TRIP", iso_currency_code: "USD" },
          { date_transacted: today, date_posted: today, amount: 412.0, description: "DELTA AIR LINES", iso_currency_code: "USD" },
        ],
      });
      console.log("Created 3 sandbox transactions. Plaid fires SYNC_UPDATES_AVAILABLE when they're ready.");
      return;
    }

    if (command === "fire-webhook") {
      await plaid.sandbox.fireItemWebhook({ access_token: accessToken, webhook_code: "SYNC_UPDATES_AVAILABLE" });
      console.log("Plaid is sending SYNC_UPDATES_AVAILABLE to the item's webhook URL.");
      return;
    }

    throw new Error(`Unknown command "${command}". Use: list | add-transactions <id> | fire-webhook <id>`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // Never print err.rawResponse: it contains request headers with the secret.
  const body = (err as { body?: unknown }).body;
  console.error(body ? JSON.stringify(body, null, 2) : err instanceof Error ? err.message : err);
  process.exit(1);
});
