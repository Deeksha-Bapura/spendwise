import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";

export type AuditEntry = {
  orgId: string;
  actorId: string | null; // null = system
  action: string; // "<entity>.<verb>", e.g. "expense.approved"
  entity: { type: string; id: string };
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ip?: string | null;
};

/**
 * Write one audit row using the *caller's* transaction client, so the audit
 * entry commits or rolls back together with the change it describes.
 *
 *   await db.$transaction(async (tx) => {
 *     const updated = await tx.expense.update(...);
 *     await recordAudit(tx, { ... before, after: updated });
 *   });
 */
export async function recordAudit(tx: Tx | Db, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entity.type,
      entityId: entry.entity.id,
      before: toJson(entry.before),
      after: toJson(entry.after),
      requestId: entry.requestId ?? null,
      ip: entry.ip ?? null,
    },
  });
}

/** JSON can't hold bigint or Date; store cents as strings and dates as ISO. */
export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
