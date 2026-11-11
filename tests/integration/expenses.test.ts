import { DEMO_ACCOUNTS, seed } from "../../prisma/seed-data";
import type { Actor } from "@/modules/auth";
import {
  createExpense,
  decideExpense,
  discardExpense,
  getExpenseDetail,
  listApprovalQueue,
  submitExpense,
  updateExpense,
} from "@/modules/expenses/server";
import { resetDb, testDb } from "../helpers/db";

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
const emma = () => actor(DEMO_ACCOUNTS.employee); // Engineering employee
const marcus = () => actor(DEMO_ACCOUNTS.manager); // Engineering manager
const fiona = () => actor(DEMO_ACCOUNTS.finance); // Finance admin (Operations)
const sara = () => actor("sara.sales.mgr@acme.test"); // Sales manager
const omar = () => actor("omar.ops.mgr@acme.test"); // Operations manager

let n = 0;
const manual = (overrides: Partial<{ amount: string; description: string }> = {}) => ({
  kind: "manual" as const,
  amount: "42.50",
  category: "Meals",
  description: `Lunch ${++n}`,
  spentAt: "2026-11-01",
  ...overrides,
});

/** Create + submit, returning the submitted expense. */
async function submitted(by: Actor) {
  const e = await createExpense(by, manual());
  return submitExpense(by, e.id, e.version);
}

describe("creating expenses", () => {
  it("from your own card transaction: amount, date and currency come from the bank", async () => {
    const me = await emma();
    const txn = await prisma.transaction.findFirstOrThrow({
      where: { account: { plaidItem: { userId: me.id } }, expense: null, amountCents: { gt: 0 }, pending: false },
    });
    const e = await createExpense(me, { kind: "transaction", transactionId: txn.id });
    expect(e).toMatchObject({ status: "DRAFT", amountCents: txn.amountCents.toString(), transactionId: txn.id, version: 0 });
    expect(e.spentAt).toBe(txn.postedAt.toISOString());
    // ...and the amount can't be edited afterwards
    await expect(updateExpense(me, e.id, { version: 0, amount: "1.00" })).rejects.toMatchObject({ status: 422 });
  });

  it("a transaction can be expensed only once", async () => {
    const me = await emma();
    const txn = await prisma.transaction.findFirstOrThrow({
      where: { account: { plaidItem: { userId: me.id } }, expense: null, amountCents: { gt: 0 }, pending: false },
    });
    const results = await Promise.allSettled([
      createExpense(me, { kind: "transaction", transactionId: txn.id }),
      createExpense(me, { kind: "transaction", transactionId: txn.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  });

  it("you can't expense someone else's transaction (looks like it doesn't exist)", async () => {
    const elisTxn = await prisma.transaction.findFirstOrThrow({ where: { plaidTransactionId: "demo_txn_eli_10" } });
    await expect(createExpense(await emma(), { kind: "transaction", transactionId: elisTxn.id })).rejects.toMatchObject({ status: 404 });
  });

  it("refunds can't be expensed", async () => {
    const me = await emma();
    const account = await prisma.bankAccount.findFirstOrThrow({ where: { plaidItem: { userId: me.id } } });
    const refund = await prisma.transaction.create({
      data: { orgId: me.orgId, accountId: account.id, plaidTransactionId: "refund_1", amountCents: -2500n, rawDescription: "REFUND", postedAt: new Date() },
    });
    await expect(createExpense(me, { kind: "transaction", transactionId: refund.id })).rejects.toMatchObject({ status: 422 });
  });

  it("pending charges can't be expensed until they post", async () => {
    const me = await emma();
    const pending = await prisma.transaction.findFirstOrThrow({
      where: { account: { plaidItem: { userId: me.id } }, pending: true, expense: null },
    });
    await expect(createExpense(me, { kind: "transaction", transactionId: pending.id })).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/pending/),
    });
  });

  it.each([["0"], ["-5"], ["12.345"], ["abc"]])("rejects manual amount %p", async (amount) => {
    await expect(createExpense(await emma(), manual({ amount }))).rejects.toMatchObject({ status: 422 });
  });

  it("rejects future dates and unknown categories", async () => {
    await expect(createExpense(await emma(), { ...manual(), spentAt: "2999-01-01" })).rejects.toMatchObject({ status: 422 });
    await expect(createExpense(await emma(), { ...manual(), category: "Yacht" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("the approval workflow", () => {
  it("draft → submitted → approved by the team manager, with audit, outbox and approval records", async () => {
    const me = await emma();
    const draft = await createExpense(me, manual());
    const sub = await submitExpense(me, draft.id, draft.version);
    expect(sub).toMatchObject({ status: "SUBMITTED", version: 1 });
    expect(sub.submittedAt).not.toBeNull();

    const approved = await decideExpense(await marcus(), draft.id, { decision: "approve", version: 1, comment: "ok" });
    expect(approved).toMatchObject({ status: "APPROVED", version: 2 });

    const audit = await prisma.auditLog.findMany({ where: { entityId: draft.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["expense.created", "expense.submitted", "expense.approved"]);
    const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: draft.id }, orderBy: { createdAt: "asc" } });
    expect(outbox.map((o) => o.type)).toEqual(["expense.submitted", "expense.approved"]);
    expect(outbox[1]!.payload).toMatchObject({ amountCents: "4250", status: "APPROVED", currency: "USD" });
    expect(await prisma.approval.count({ where: { expenseId: draft.id, decision: "APPROVED" } })).toBe(1);
  });

  it("reject needs a comment; the employee edits and resubmits", async () => {
    const me = await emma();
    const sub = await submitted(me);
    await expect(decideExpense(await marcus(), sub.id, { decision: "reject", version: sub.version })).rejects.toMatchObject({ status: 422 });

    const rejected = await decideExpense(await marcus(), sub.id, { decision: "reject", version: sub.version, comment: "Add attendees" });
    expect(rejected.status).toBe("REJECTED");

    const edited = await updateExpense(me, sub.id, { version: rejected.version, description: "Lunch with Acme (Emma, Jo)" });
    expect(edited.status).toBe("DRAFT");
    const resubmitted = await submitExpense(me, sub.id, edited.version);
    expect(resubmitted.status).toBe("SUBMITTED");
  });

  it("nobody approves their own expense: a manager's goes to finance", async () => {
    const boss = await marcus();
    const sub = await submitted(boss);
    await expect(decideExpense(boss, sub.id, { decision: "approve", version: sub.version })).rejects.toMatchObject({ status: 403 });
    expect((await listApprovalQueue(boss)).map((e) => e.id)).not.toContain(sub.id);
    expect((await listApprovalQueue(await fiona())).map((e) => e.id)).toContain(sub.id);
    await expect(decideExpense(await fiona(), sub.id, { decision: "approve", version: sub.version })).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("finance's own expense goes to their team manager", async () => {
    const fin = await fiona();
    const sub = await submitted(fin);
    await expect(decideExpense(fin, sub.id, { decision: "approve", version: sub.version })).rejects.toMatchObject({ status: 403 });
    await expect(decideExpense(await omar(), sub.id, { decision: "approve", version: sub.version })).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("another team's manager can neither approve nor even see it", async () => {
    const sub = await submitted(await emma());
    await expect(decideExpense(await sara(), sub.id, { decision: "approve", version: sub.version })).rejects.toMatchObject({ status: 404 });
    expect(await getExpenseDetail(await sara(), sub.id)).toBeNull();
  });

  it("employees can't approve, even a teammate's expense", async () => {
    const eli = await actor("eli@acme.test");
    const sub = await submitted(await emma());
    await expect(decideExpense(eli, sub.id, { decision: "approve", version: sub.version })).rejects.toMatchObject({ status: 404 });
  });

  it("only the submitter can edit or submit", async () => {
    const draft = await createExpense(await emma(), manual());
    await expect(submitExpense(await marcus(), draft.id, draft.version)).rejects.toMatchObject({ status: 403 });
  });

  it("approved expenses are final", async () => {
    const me = await emma();
    const sub = await submitted(me);
    const approved = await decideExpense(await marcus(), sub.id, { decision: "approve", version: sub.version });
    await expect(updateExpense(me, sub.id, { version: approved.version, description: "x" })).rejects.toMatchObject({ status: 409 });
    await expect(decideExpense(await fiona(), sub.id, { decision: "reject", version: approved.version, comment: "no" })).rejects.toMatchObject({ status: 409 });
  });

  it("drafts can be discarded; the audit log keeps the record", async () => {
    const me = await emma();
    const draft = await createExpense(me, manual());
    await discardExpense(me, draft.id, draft.version);
    expect(await prisma.expense.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: draft.id, action: "expense.discarded" } })).toBe(1);
  });
});

describe("optimistic locking", () => {
  it("two approvers clicking at once: exactly one decision lands, the other gets 409", async () => {
    const sub = await submitted(await emma());
    const results = await Promise.allSettled([
      decideExpense(await marcus(), sub.id, { decision: "approve", version: sub.version }),
      decideExpense(await fiona(), sub.id, { decision: "reject", version: sub.version, comment: "dup" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });

    // Exactly one approval row, one decision event, one outbox event: no half-applied loser.
    expect(await prisma.approval.count({ where: { expenseId: sub.id } })).toBe(1);
    const decisions = await prisma.auditLog.count({ where: { entityId: sub.id, action: { in: ["expense.approved", "expense.rejected"] } } });
    expect(decisions).toBe(1);
    const events = await prisma.outboxEvent.count({ where: { aggregateId: sub.id, type: { in: ["expense.approved", "expense.rejected"] } } });
    expect(events).toBe(1);
  });

  it("acting on a stale version is refused", async () => {
    const me = await emma();
    const draft = await createExpense(me, manual());
    await updateExpense(me, draft.id, { version: 0, description: "first edit" }); // now version 1
    await expect(updateExpense(me, draft.id, { version: 0, description: "edit from an old tab" })).rejects.toMatchObject({
      status: 409,
    });
    const saved = await prisma.expense.findUniqueOrThrow({ where: { id: draft.id } });
    expect(saved).toMatchObject({ description: "first edit", version: 1 });
  });

  it("a double-clicked submit applies once", async () => {
    const me = await emma();
    const draft = await createExpense(me, manual());
    const results = await Promise.allSettled([submitExpense(me, draft.id, 0), submitExpense(me, draft.id, 0)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: draft.id, type: "expense.submitted" } })).toBe(1);
  });
});

describe("approval queues", () => {
  it("a manager sees their team's submitted expenses, oldest first, never their own", async () => {
    const queue = await listApprovalQueue(await marcus());
    const boss = await marcus();
    expect(queue.length).toBeGreaterThan(0);
    for (const e of queue) {
      expect(e.status).toBe("SUBMITTED");
      expect(e.submitter.id).not.toBe(boss.id);
      expect(e.submitter.team).toBe("Engineering");
    }
    const times = queue.map((e) => e.submittedAt!);
    expect([...times].sort()).toEqual(times);
  });

  it("the Sales manager sees Sam's seeded expense and nothing from Engineering", async () => {
    const queue = await listApprovalQueue(await sara());
    expect(queue.map((e) => e.id)).toContain("demo_exp_sam_submitted");
    expect(queue.every((e) => e.submitter.team === "Sales")).toBe(true);
  });

  it("employees have no queue", async () => {
    expect(await listApprovalQueue(await emma())).toEqual([]);
  });
});

describe("expense detail", () => {
  it("shows history and only the actions this viewer may take", async () => {
    const draft = await createExpense(await emma(), manual());
    const mine = await getExpenseDetail(await emma(), draft.id);
    expect(mine!.actions).toEqual(["edit", "submit", "discard"]);

    await submitExpense(await emma(), draft.id, 0);
    expect((await getExpenseDetail(await emma(), draft.id))!.actions).toEqual([]);
    const forManager = await getExpenseDetail(await marcus(), draft.id);
    expect(forManager!.actions).toEqual(["approve", "reject"]);
    expect(forManager!.history.map((h) => h.action)).toEqual(["expense.created", "expense.submitted"]);
  });
});
