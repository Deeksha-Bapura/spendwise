import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExpenseActions } from "@/components/ExpenseActions";
import { ExpenseStatusBadge } from "@/components/ExpenseStatusBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/modules/auth/server";
import { getExpenseDetail } from "@/modules/expenses/server";

export const metadata = { title: "Expense · Spendwise" };

const ACTION_LABEL: Record<string, string> = {
  "expense.created": "Created",
  "expense.updated": "Edited",
  "expense.submitted": "Submitted for approval",
  "expense.approved": "Approved",
  "expense.rejected": "Rejected",
};

export default function ExpensePage({ params }: PageProps<"/expenses/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Expense params={params} />
    </Suspense>
  );
}

async function Expense({ params }: Pick<PageProps<"/expenses/[id]">, "params">) {
  const user = await requireUser();
  const detail = await getExpenseDetail(user, (await params).id);
  // Not yours and not your team's looks the same as nonexistent.
  if (!detail) notFound();
  const { expense, transaction, approvals, history, actions } = detail;
  const cents = BigInt(expense.amountCents);

  return (
    <section className="space-y-6">
      <Link href="/expenses" className="text-sm text-brand-700 hover:underline">← My expenses</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="expense-description">{expense.description}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {expense.submitter.name}{expense.submitter.team && ` · ${expense.submitter.team}`} · {expense.category} · spent {expense.spentAt.slice(0, 10)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold" data-testid="expense-amount">{formatCents(cents, expense.currency)}</p>
          <ExpenseStatusBadge status={expense.status} testId="expense-detail-status" />
        </div>
      </div>

      {transaction && (
        <p className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-700">
          From card transaction: <span className="font-medium">{transaction.merchant}</span> on {transaction.postedAt.slice(0, 10)} · {transaction.account}
        </p>
      )}

      <ExpenseActions
        expenseId={expense.id}
        version={expense.version}
        actions={actions}
        manual={!expense.transactionId}
        current={{
          category: expense.category,
          description: expense.description,
          amount: `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`,
          spentAt: expense.spentAt.slice(0, 10),
        }}
      />

      {approvals.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">Decisions</h2>
          <ul className="space-y-2 text-sm" data-testid="approvals">
            {approvals.map((a) => (
              <li key={a.id}>
                <span className={a.decision === "APPROVED" ? "font-medium text-brand-700" : "font-medium text-red-700"}>
                  {a.decision === "APPROVED" ? "Approved" : "Rejected"}
                </span>{" "}
                by {a.approver} · {a.createdAt.slice(0, 16).replace("T", " ")} UTC
                {a.comment && <p className="mt-0.5 text-stone-600">&ldquo;{a.comment}&rdquo;</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        <ol className="space-y-1.5 text-sm" data-testid="expense-history">
          {history.map((h) => (
            <li key={h.id} className="flex gap-3">
              <span className="w-36 shrink-0 text-stone-500">{h.createdAt.slice(0, 16).replace("T", " ")}</span>
              <span>{ACTION_LABEL[h.action] ?? h.action} · {h.actor}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
