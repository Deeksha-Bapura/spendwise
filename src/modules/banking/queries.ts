import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/modules/auth";
import { DEMO_ITEM_PREFIX } from "./sync";

/**
 * Which transactions an actor may see, as a Prisma filter. Mirrors the
 * "transaction:read" rules in rbac.ts: employees see their own, managers
 * their team's, finance admins the whole org. Always scoped to the org.
 */
export function transactionScope(actor: Actor): Prisma.TransactionWhereInput {
  const base: Prisma.TransactionWhereInput = { orgId: actor.orgId, removedAt: null };
  switch (actor.role) {
    case "EMPLOYEE":
      return { ...base, account: { plaidItem: { userId: actor.id } } };
    case "MANAGER":
      return {
        ...base,
        account: {
          plaidItem: actor.teamId
            ? { OR: [{ userId: actor.id }, { user: { teamId: actor.teamId } }] }
            : { userId: actor.id },
        },
      };
    case "FINANCE_ADMIN":
      return base;
  }
}

export type TransactionRow = {
  id: string;
  postedAt: string;
  merchantName: string | null;
  description: string;
  amountCents: string; // bigint as string: JSON has no bigint
  currency: string;
  pending: boolean;
  plaidCategory: string | null;
  account: { name: string; mask: string | null };
  owner: { id: string; name: string };
  expenseId: string | null;
};

type Cursor = { postedAt: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof c.id !== "string" || Number.isNaN(Date.parse(c.postedAt))) return null;
    return c;
  } catch {
    return null;
  }
}

/**
 * Keyset pagination, newest first, ordered by (postedAt, id). Unlike
 * OFFSET, each page costs the same however deep you go, and rows inserted
 * by a sync mid-scroll don't shift the pages.
 */
export async function listTransactions(
  actor: Actor,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<{ rows: TransactionRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const cursor = decodeCursor(opts.cursor);
  const where: Prisma.TransactionWhereInput = cursor
    ? {
        AND: [
          transactionScope(actor),
          {
            OR: [
              { postedAt: { lt: new Date(cursor.postedAt) } },
              { postedAt: new Date(cursor.postedAt), id: { lt: cursor.id } },
            ],
          },
        ],
      }
    : transactionScope(actor);

  const rows = await db.transaction.findMany({
    where,
    orderBy: [{ postedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      postedAt: true,
      merchantName: true,
      rawDescription: true,
      amountCents: true,
      currency: true,
      pending: true,
      plaidCategory: true,
      expense: { select: { id: true } },
      account: {
        select: { name: true, mask: true, plaidItem: { select: { user: { select: { id: true, name: true } } } } },
      },
    },
  });

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map((r) => ({
      id: r.id,
      postedAt: r.postedAt.toISOString(),
      merchantName: r.merchantName,
      description: r.rawDescription,
      amountCents: r.amountCents.toString(),
      currency: r.currency,
      pending: r.pending,
      plaidCategory: r.plaidCategory,
      account: { name: r.account.name, mask: r.account.mask },
      owner: r.account.plaidItem.user,
      expenseId: r.expense?.id ?? null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor({ postedAt: last.postedAt.toISOString(), id: last.id }) : null,
  };
}

/** The signed-in user's own bank connections. */
export async function listItemsForUser(userId: string) {
  const items = await db.plaidItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      plaidItemId: true,
      institutionName: true,
      status: true,
      lastSyncedAt: true,
      lastSyncError: true,
      accounts: { select: { id: true, name: true, mask: true, type: true, _count: { select: { transactions: true } } } },
    },
  });
  return items.map(({ plaidItemId, ...i }) => ({ ...i, isDemo: plaidItemId.startsWith(DEMO_ITEM_PREFIX) }));
}

export async function getItemOwner(itemId: string) {
  return db.plaidItem.findUnique({
    where: { id: itemId },
    select: { id: true, orgId: true, userId: true, user: { select: { teamId: true } } },
  });
}
