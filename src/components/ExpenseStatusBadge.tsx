import type { ExpenseStatus } from "@/modules/expenses";

const STYLES: Record<ExpenseStatus, string> = {
  DRAFT: "bg-stone-100 text-stone-700 ring-stone-200",
  SUBMITTED: "bg-sky-50 text-sky-800 ring-sky-200",
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-100",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  REIMBURSED: "bg-violet-50 text-violet-700 ring-violet-200",
};

const LABELS: Record<ExpenseStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REIMBURSED: "Reimbursed",
};

export function ExpenseStatusBadge({ status, testId = "expense-status" }: { status: ExpenseStatus; testId?: string }) {
  return (
    <span data-testid={testId} className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
