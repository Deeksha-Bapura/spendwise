import { Suspense } from "react";
import { roleLabel } from "@/components/RoleBadge";
import { PageSkeleton } from "@/components/Skeleton";
import Link from "next/link";
import { requireUser } from "@/modules/auth/server";
import { expenseCounts } from "@/modules/expenses/server";
import { getUserProfile } from "@/modules/org";

export const metadata = { title: "Dashboard · Spendwise" };

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
  const [profile, counts] = await Promise.all([getUserProfile(user.id), expenseCounts(user)]);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name.split(" ")[0]}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Role" value={roleLabel(user.role)} testId="profile-role" />
        <Card label="Team" value={profile?.team?.name ?? "—"} testId="profile-team" />
        <Card label="Organization" value={profile?.org.name ?? "—"} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <LinkCard href="/expenses" label="Drafts to finish" value={counts.drafts} testId="count-drafts" />
        <LinkCard href="/expenses" label="Waiting on approval" value={counts.mineSubmitted} testId="count-submitted" />
        {user.role !== "EMPLOYEE" && (
          <LinkCard href="/approvals" label="Waiting on you" value={counts.awaitingMe} testId="count-awaiting-me" />
        )}
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

function LinkCard({ href, label, value, testId }: { href: string; label: string; value: number; testId: string }) {
  return (
    <Link href={href} className="rounded-lg border border-stone-200 bg-white p-5 hover:border-brand-600">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold" data-testid={testId}>{value}</p>
    </Link>
  );
}
