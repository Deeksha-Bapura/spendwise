import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { parseToCents } from "@/lib/money";
import { recordAudit } from "@/modules/audit";
import { can, type Actor } from "@/modules/auth";
import { enqueueOutbox } from "@/modules/events";
import {
  availableActions,
  EXPENSE_CATEGORIES,
  InvalidTransitionError,
  nextStatus,
  performedBy,
  suggestCategory,
  type ExpenseAction,
  type ExpenseStatus,
} from "./workflow";

export type RequestMeta = { requestId?: string | null; ip?: string | null };

const notFound = () => new HttpError(404, "Expense not found");
const conflict = (message: string) => new HttpError(409, message);

/* ───────────── Visibility ───────────── */

/** Which expenses an actor may see. Mirrors "expense:read" in rbac.ts. */
export function expenseScope(actor: Actor): Prisma.ExpenseWhereInput {
  const base = { orgId: actor.orgId };
  switch (actor.role) {
    case "EMPLOYEE":
      return { ...base, submitterId: actor.id };
    case "MANAGER":
      return actor.teamId
        ? { ...base, OR: [{ submitterId: actor.id }, { submitter: { teamId: actor.teamId } }] }
        : { ...base, submitterId: actor.id };
    case "FINANCE_ADMIN":
      return base;
  }
}

const resourceOf = (e: { orgId: string; submitterId: string; submitter: { teamId: string | null } }) => ({
  orgId: e.orgId,
  ownerId: e.submitterId,
  teamId: e.submitter.teamId,
});

/* ───────────── Create ───────────── */

export type CreateExpenseInput =
  | { kind: "transaction"; transactionId: string; category?: string; description?: string }
  | { kind: "manual"; amount: string; currency?: string; category: string; description: string; spentAt: string };

function assertCategory(category: string) {
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    throw new HttpError(422, `Unknown category "${category}"`);
  }
}

export async function createExpense(actor: Actor, input: CreateExpenseInput, meta: RequestMeta = {}) {
  if (!can(actor, "expense:create")) throw new HttpError(403, "Forbidden");

  return db.$transaction(async (tx) => {
    let data: Prisma.ExpenseUncheckedCreateInput;

    if (input.kind === "transaction") {
      const txn = await tx.transaction.findFirst({
        where: { id: input.transactionId, orgId: actor.orgId, removedAt: null },
        select: {
          id: true,
          amountCents: true,
          currency: true,
          postedAt: true,
          merchantName: true,
          rawDescription: true,
          plaidCategory: true,
          pending: true,
          expense: { select: { id: true } },
          account: { select: { plaidItem: { select: { userId: true } } } },
        },
      });
      // Someone else's transaction looks exactly like a missing one.
      if (!txn || txn.account.plaidItem.userId !== actor.id) throw new HttpError(404, "Transaction not found");
      if (txn.expense) throw conflict("This transaction already has an expense");
      if (txn.amountCents <= 0n) throw new HttpError(422, "Refunds and deposits can't be expensed");
      // When a pending charge posts, Plaid replaces it with a new transaction (new id,
      // sometimes a new amount, e.g. a tip). Expense the posted one instead.
      if (txn.pending) throw new HttpError(422, "This charge is still pending. You can expense it once it posts.");
      const category = input.category ?? suggestCategory(txn.plaidCategory);
      assertCategory(category);
      data = {
        orgId: actor.orgId,
        submitterId: actor.id,
        transactionId: txn.id,
        // Card transactions are the source of truth: the amount comes from the bank, not the user.
        amountCents: txn.amountCents,
        currency: txn.currency,
        spentAt: txn.postedAt,
        category,
        description: (input.description ?? txn.merchantName ?? txn.rawDescription).slice(0, 500),
      };
    } else {
      assertCategory(input.category);
      let amountCents: bigint;
      try {
        amountCents = parseToCents(input.amount);
      } catch {
        throw new HttpError(422, "Enter an amount like 42.50");
      }
      if (amountCents <= 0n) throw new HttpError(422, "Amount must be greater than zero");
      const spentAt = new Date(input.spentAt);
      if (Number.isNaN(spentAt.getTime()) || spentAt > new Date()) throw new HttpError(422, "Enter a valid date, not in the future");
      data = {
        orgId: actor.orgId,
        submitterId: actor.id,
        amountCents,
        currency: input.currency ?? "USD",
        spentAt,
        category: input.category,
        description: input.description.slice(0, 500),
      };
    }

    let expense;
    try {
      expense = await tx.expense.create({ data });
    } catch (err) {
      // Two requests racing to expense the same transaction: the unique index decides.
      if ((err as { code?: string }).code === "P2002") throw conflict("This transaction already has an expense");
      throw err;
    }
    await recordAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.id,
      action: "expense.created",
      entity: { type: "Expense", id: expense.id },
      after: expense,
      ...meta,
    });
    return toDto(expense);
  });
}

/* ───────────── Transitions ───────────── */

type Change = {
  action: ExpenseAction;
  version: number;
  data?: Prisma.ExpenseUncheckedUpdateManyInput;
  comment?: string | null;
};

/**
 * Every status change goes through here:
 *  1. load the expense; 404 if the actor can't see it;
 *  2. check the actor's relationship (submitter vs approver) and permission;
 *  3. check the workflow allows the move (409 if not);
 *  4. write with optimistic locking: `WHERE id = ? AND version = ?`.
 *     If someone else changed it first, zero rows match → 409;
 *  5. audit + outbox (+ approval record) in the same transaction.
 */
async function transition(actor: Actor, expenseId: string, change: Change, meta: RequestMeta) {
  return db.$transaction(async (tx) => {
    const before = await tx.expense.findUnique({
      where: { id: expenseId },
      include: { submitter: { select: { teamId: true } } },
    });
    if (!before || before.orgId !== actor.orgId || !can(actor, "expense:read", resourceOf(before))) {
      throw notFound();
    }

    const relation = performedBy(change.action);
    if (relation === "submitter" && before.submitterId !== actor.id) {
      throw new HttpError(403, "Only the person who submitted this expense can do that");
    }
    if (relation === "approver" && !can(actor, "expense:approve", resourceOf(before))) {
      throw new HttpError(
        403,
        before.submitterId === actor.id ? "You can't approve your own expense" : "You can't approve this expense",
      );
    }

    if (before.version !== change.version) {
      throw conflict("This expense changed since you loaded it. Refresh to see the latest version.");
    }

    let to: ExpenseStatus | null;
    try {
      to = nextStatus(before.status, change.action);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw conflict(err.message);
      throw err;
    }

    if (to === null) {
      // discard: drafts only; delete guarded by version too.
      const deleted = await tx.expense.deleteMany({ where: { id: before.id, version: change.version } });
      if (deleted.count === 0) throw conflict("This expense changed since you loaded it.");
      await recordAudit(tx, {
        orgId: before.orgId,
        actorId: actor.id,
        action: "expense.discarded",
        entity: { type: "Expense", id: before.id },
        before,
        ...meta,
      });
      return null;
    }

    const updated = await tx.expense.updateMany({
      where: { id: before.id, version: change.version },
      data: {
        ...change.data,
        status: to,
        version: { increment: 1 },
        ...(change.action === "submit" ? { submittedAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) {
      throw conflict("Someone else just changed this expense. Refresh to see the latest version.");
    }
    const after = await tx.expense.findUniqueOrThrow({ where: { id: before.id } });

    if (change.action === "approve" || change.action === "reject") {
      await tx.approval.create({
        data: {
          expenseId: before.id,
          approverId: actor.id,
          decision: change.action === "approve" ? "APPROVED" : "REJECTED",
          comment: change.comment ?? null,
        },
      });
    }

    const eventType = { edit: "expense.updated", submit: "expense.submitted", approve: "expense.approved", reject: "expense.rejected", discard: "expense.discarded" }[change.action];
    await recordAudit(tx, {
      orgId: before.orgId,
      actorId: actor.id,
      action: eventType,
      entity: { type: "Expense", id: before.id },
      before: pickAuditFields(before),
      after: { ...pickAuditFields(after), ...(change.comment ? { comment: change.comment } : {}) },
      ...meta,
    });
    if (change.action !== "edit") {
      await enqueueOutbox(tx, {
        orgId: before.orgId,
        aggregateType: "Expense",
        aggregateId: before.id,
        type: eventType,
        payload: {
          expenseId: before.id,
          submitterId: before.submitterId,
          amountCents: after.amountCents,
          currency: after.currency,
          status: after.status,
          version: after.version,
          actorId: actor.id,
        },
      });
    }
    return toDto(after);
  });
}

/** Every action except discard returns the updated expense. */
function updatedDto(dto: ExpenseDto | null): ExpenseDto {
  if (!dto) throw new Error("expected an updated expense");
  return dto;
}

function pickAuditFields(e: { status: string; amountCents: bigint; currency: string; category: string; description: string; version: number }) {
  return {
    status: e.status,
    amountCents: e.amountCents,
    currency: e.currency,
    category: e.category,
    description: e.description,
    version: e.version,
  };
}

export type UpdateExpenseInput = {
  version: number;
  category?: string;
  description?: string;
  amount?: string; // manual expenses only
  spentAt?: string; // manual expenses only
};

export async function updateExpense(actor: Actor, id: string, input: UpdateExpenseInput, meta: RequestMeta = {}) {
  const data: Prisma.ExpenseUncheckedUpdateManyInput = {};
  if (input.category !== undefined) {
    assertCategory(input.category);
    data.category = input.category;
  }
  if (input.description !== undefined) {
    if (!input.description.trim()) throw new HttpError(422, "Description is required");
    data.description = input.description.slice(0, 500);
  }
  if (input.amount !== undefined || input.spentAt !== undefined) {
    const existing = await db.expense.findFirst({ where: { id, orgId: actor.orgId }, select: { transactionId: true } });
    if (existing?.transactionId) throw new HttpError(422, "Amount and date come from the card transaction");
    if (input.amount !== undefined) {
      let cents: bigint;
      try {
        cents = parseToCents(input.amount);
      } catch {
        throw new HttpError(422, "Enter an amount like 42.50");
      }
      if (cents <= 0n) throw new HttpError(422, "Amount must be greater than zero");
      data.amountCents = cents;
    }
    if (input.spentAt !== undefined) {
      const d = new Date(input.spentAt);
      if (Number.isNaN(d.getTime()) || d > new Date()) throw new HttpError(422, "Enter a valid date, not in the future");
      data.spentAt = d;
    }
  }
  return transition(actor, id, { action: "edit", version: input.version, data }, meta).then(updatedDto);
}

export const submitExpense = (actor: Actor, id: string, version: number, meta: RequestMeta = {}) =>
  transition(actor, id, { action: "submit", version }, meta).then(updatedDto);

export async function decideExpense(
  actor: Actor,
  id: string,
  input: { decision: "approve" | "reject"; version: number; comment?: string | null },
  meta: RequestMeta = {},
) {
  const comment = input.comment?.trim() || null;
  if (input.decision === "reject" && !comment) {
    throw new HttpError(422, "Add a comment explaining why it's rejected");
  }
  return transition(actor, id, { action: input.decision, version: input.version, comment }, meta).then(updatedDto);
}

export const discardExpense = async (actor: Actor, id: string, version: number, meta: RequestMeta = {}) => {
  await transition(actor, id, { action: "discard", version }, meta);
};

/* ───────────── Reads ───────────── */

export type ExpenseDto = {
  id: string;
  status: ExpenseStatus;
  amountCents: string;
  currency: string;
  category: string;
  description: string;
  spentAt: string;
  submittedAt: string | null;
  createdAt: string;
  version: number;
  transactionId: string | null;
};

function toDto(e: {
  id: string;
  status: ExpenseStatus;
  amountCents: bigint;
  currency: string;
  category: string;
  description: string;
  spentAt: Date;
  submittedAt: Date | null;
  createdAt: Date;
  version: number;
  transactionId: string | null;
}): ExpenseDto {
  return {
    id: e.id,
    status: e.status,
    amountCents: e.amountCents.toString(),
    currency: e.currency,
    category: e.category,
    description: e.description,
    spentAt: e.spentAt.toISOString(),
    submittedAt: e.submittedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    version: e.version,
    transactionId: e.transactionId,
  };
}

const listSelect = {
  id: true,
  status: true,
  amountCents: true,
  currency: true,
  category: true,
  description: true,
  spentAt: true,
  submittedAt: true,
  createdAt: true,
  version: true,
  transactionId: true,
  submitter: { select: { id: true, name: true, team: { select: { name: true } } } },
} satisfies Prisma.ExpenseSelect;

export type ExpenseListItem = ExpenseDto & { submitter: { id: string; name: string; team: string | null } };

function toListItem(e: Prisma.ExpenseGetPayload<{ select: typeof listSelect }>): ExpenseListItem {
  return { ...toDto(e), submitter: { id: e.submitter.id, name: e.submitter.name, team: e.submitter.team?.name ?? null } };
}

export async function listMyExpenses(actor: Actor): Promise<ExpenseListItem[]> {
  const rows = await db.expense.findMany({
    where: { orgId: actor.orgId, submitterId: actor.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: listSelect,
  });
  return rows.map(toListItem);
}

/** Submitted expenses this actor may approve, oldest first (first in, first out). */
export async function listApprovalQueue(actor: Actor): Promise<ExpenseListItem[]> {
  if (actor.role === "EMPLOYEE") return [];
  const rows = await db.expense.findMany({
    where: {
      AND: [
        expenseScope(actor),
        { status: "SUBMITTED", submitterId: { not: actor.id } },
        actor.role === "MANAGER" ? { submitter: { teamId: actor.teamId ?? "__none__" } } : {},
      ],
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take: 200,
    select: listSelect,
  });
  return rows.map(toListItem);
}

export async function getExpenseDetail(actor: Actor, id: string) {
  const e = await db.expense.findUnique({
    where: { id },
    select: {
      ...listSelect,
      orgId: true,
      submitterId: true,
      submitter: { select: { id: true, name: true, teamId: true, team: { select: { name: true } } } },
      transaction: {
        select: { merchantName: true, rawDescription: true, postedAt: true, account: { select: { name: true, mask: true } } },
      },
      approvals: {
        orderBy: { createdAt: "asc" },
        select: { id: true, decision: true, comment: true, createdAt: true, approver: { select: { name: true } } },
      },
    },
  });
  if (!e || e.orgId !== actor.orgId) return null;
  const resource = { orgId: e.orgId, ownerId: e.submitterId, teamId: e.submitter.teamId };
  if (!can(actor, "expense:read", resource)) return null;

  const history = await db.auditLog.findMany({
    where: { orgId: e.orgId, entityType: "Expense", entityId: e.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, action: true, createdAt: true, actor: { select: { name: true } } },
  });

  const actions: ExpenseAction[] = [
    ...(e.submitterId === actor.id ? availableActions(e.status, "submitter") : []),
    ...(can(actor, "expense:approve", resource) ? availableActions(e.status, "approver") : []),
  ];

  return {
    expense: {
      ...toDto(e),
      submitter: { id: e.submitter.id, name: e.submitter.name, team: e.submitter.team?.name ?? null },
    },
    transaction: e.transaction
      ? {
          merchant: e.transaction.merchantName ?? e.transaction.rawDescription,
          postedAt: e.transaction.postedAt.toISOString(),
          account: `${e.transaction.account.name}${e.transaction.account.mask ? ` ••${e.transaction.account.mask}` : ""}`,
        }
      : null,
    approvals: e.approvals.map((a) => ({
      id: a.id,
      decision: a.decision,
      comment: a.comment,
      createdAt: a.createdAt.toISOString(),
      approver: a.approver.name,
    })),
    history: history.map((h) => ({ id: h.id, action: h.action, createdAt: h.createdAt.toISOString(), actor: h.actor?.name ?? "System" })),
    actions,
  };
}

export type ExpenseDetail = NonNullable<Awaited<ReturnType<typeof getExpenseDetail>>>;

export async function expenseCounts(actor: Actor) {
  const [drafts, awaitingMe, mineSubmitted] = await Promise.all([
    db.expense.count({ where: { orgId: actor.orgId, submitterId: actor.id, status: { in: ["DRAFT", "REJECTED"] } } }),
    listApprovalQueue(actor).then((q) => q.length),
    db.expense.count({ where: { orgId: actor.orgId, submitterId: actor.id, status: "SUBMITTED" } }),
  ]);
  return { drafts, awaitingMe, mineSubmitted };
}

export type { Tx };
