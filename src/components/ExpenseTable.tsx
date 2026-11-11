import Link from "next/link";
import { formatCents } from "@/lib/money";
import type { ExpenseStatus } from "@/modules/expenses";
import { ExpenseStatusBadge } from "./ExpenseStatusBadge";

type Row = {
  id: string;
  status: ExpenseStatus;
  amountCents: string;
  currency: string;
  category: string;
  description: string;
  spentAt: string;
  submitter: { name: string; team: string | null };
};

export function ExpenseTable({ rows, showSubmitter, testId }: { rows: Row[]; showSubmitter: boolean; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full text-left text-sm" data-testid={testId}>
        <thead className="border-b border-stone-200 text-xs uppercase text-stone-500">
          <tr>
            <th className="px-4 py-2">Date</th>
            {showSubmitter && <th className="px-4 py-2">Submitted by</th>}
            <th className="px-4 py-2">Description</th>
            <th className="px-4 py-2">Category</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-t border-stone-100 hover:bg-stone-50" data-testid="expense-row">
              <td className="whitespace-nowrap px-4 py-2 text-stone-500">{e.spentAt.slice(0, 10)}</td>
              {showSubmitter && (
                <td className="px-4 py-2">
                  {e.submitter.name}
                  {e.submitter.team && <span className="text-stone-500"> · {e.submitter.team}</span>}
                </td>
              )}
              <td className="px-4 py-2">
                <Link href={`/expenses/${e.id}`} className="font-medium text-brand-700 hover:underline">
                  {e.description}
                </Link>
              </td>
              <td className="px-4 py-2 text-stone-600">{e.category}</td>
              <td className="px-4 py-2"><ExpenseStatusBadge status={e.status} /></td>
              <td className="whitespace-nowrap px-4 py-2 text-right font-mono">{formatCents(BigInt(e.amountCents), e.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
