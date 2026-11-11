import { Suspense } from "react";
import { ExpenseTable } from "@/components/ExpenseTable";
import { NewExpenseForm } from "@/components/NewExpenseForm";
import { PageSkeleton } from "@/components/Skeleton";
import { requireUser } from "@/modules/auth/server";
import { listMyExpenses } from "@/modules/expenses/server";

export const metadata = { title: "Expenses · Spendwise" };

export default function ExpensesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Expenses />
    </Suspense>
  );
}

async function Expenses() {
  const user = await requireUser();
  const expenses = await listMyExpenses(user);
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My expenses</h1>
          <p className="mt-1 text-sm text-stone-600">
            Expense a card transaction from the Transactions page, or add one by hand.
          </p>
        </div>
        <NewExpenseForm />
      </div>
      {expenses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600">No expenses yet.</p>
      ) : (
        <ExpenseTable rows={expenses} showSubmitter={false} testId="my-expenses" />
      )}
    </section>
  );
}
