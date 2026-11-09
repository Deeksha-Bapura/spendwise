import { Suspense } from "react";
import { PageSkeleton } from "@/components/Skeleton";
import { TransactionsTable } from "@/components/TransactionsTable";
import { requireUser } from "@/modules/auth/server";

export const metadata = { title: "Transactions · Spendwise" };

const SCOPE = {
  EMPLOYEE: "Your card and bank transactions.",
  MANAGER: "Transactions for you and your team.",
  FINANCE_ADMIN: "All transactions across the organization.",
} as const;

export default function TransactionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Transactions />
    </Suspense>
  );
}

async function Transactions() {
  const user = await requireUser();
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="mt-1 text-sm text-stone-600" data-testid="transactions-scope">{SCOPE[user.role]}</p>
      </div>
      <TransactionsTable showOwner={user.role !== "EMPLOYEE"} />
    </section>
  );
}
