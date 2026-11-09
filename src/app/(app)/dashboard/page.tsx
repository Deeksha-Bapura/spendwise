import { Suspense } from "react";
import { roleLabel } from "@/components/RoleBadge";
import { PageSkeleton } from "@/components/Skeleton";
import { requireUser } from "@/modules/auth/server";
import { getUserProfile } from "@/modules/org";

export const metadata = { title: "Dashboard · Spendwise" };

const NEXT_UP: Record<string, string> = {
  EMPLOYEE: "Connect a bank account and submit expenses (Steps 2–3).",
  MANAGER: "Review and approve your team's expenses (Step 3).",
  FINANCE_ADMIN: "Org-wide spend, policies and the audit log (Steps 3–5).",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

// Reads the session, so it renders inside the Suspense boundary above.
async function Dashboard() {
  const user = await requireUser();
  const profile = await getUserProfile(user.id);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name.split(" ")[0]}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Role" value={roleLabel(user.role)} testId="profile-role" />
        <Card label="Team" value={profile?.team?.name ?? "—"} testId="profile-team" />
        <Card label="Organization" value={profile?.org.name ?? "—"} />
      </div>
      <div className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600">
        <p className="font-medium text-stone-800">Coming next</p>
        <p className="mt-1">{NEXT_UP[user.role]}</p>
      </div>
    </section>
  );
}

function Card({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold" data-testid={testId}>{value}</p>
    </div>
  );
}
