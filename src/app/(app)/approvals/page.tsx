import { Suspense } from "react";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { Forbidden } from "@/components/Forbidden";
import { PageSkeleton } from "@/components/Skeleton";
import { requireUser } from "@/modules/auth/server";
import { listApprovalQueue } from "@/modules/expenses/server";

export const metadata = { title: "Approvals · Spendwise" };

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Approvals />
    </Suspense>
  );
}

async function Approvals() {
  const user = await requireUser();
  if (user.role === "EMPLOYEE") return <Forbidden />;
  const queue = await listApprovalQueue(user);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="mt-1 text-sm text-stone-600">
          {user.role === "MANAGER"
            ? "Expenses your team submitted, oldest first. Your own expenses go to finance."
            : "Every submitted expense in the organization, oldest first. Your own go to your team manager."}
        </p>
      </div>
      <ApprovalQueue rows={queue} />
    </section>
  );
}
