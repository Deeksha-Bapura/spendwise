import { Suspense } from "react";
import { Forbidden } from "@/components/Forbidden";
import { PageSkeleton } from "@/components/Skeleton";
import { roleLabel } from "@/components/RoleBadge";
import { can } from "@/modules/auth";
import { requireUser } from "@/modules/auth/server";
import { getOrgOverview } from "@/modules/org";

export const metadata = { title: "Admin · Spendwise" };

export default function AdminPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Admin />
    </Suspense>
  );
}

// Reads the session, so it renders inside the Suspense boundary above.
async function Admin() {
  const user = await requireUser();
  // Checked on the server before any admin data is loaded.
  if (!can(user, "admin:access")) return <Forbidden />;

  const { roleCounts, teams, policies, recentAudit } = await getOrgOverview(user.orgId);

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="People">
          <ul className="space-y-1 text-sm">
            {roleCounts.map((r) => (
              <li key={r.role} className="flex justify-between">
                <span>{roleLabel(r.role)}</span>
                <span className="font-medium">{r._count._all}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
            {teams.map((t) => (
              <li key={t.id} className="flex justify-between">
                <span>{t.name}</span>
                <span className="text-stone-500">
                  {t.manager?.name ?? "No manager"} · {t._count.members} people
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Active policies">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {policies.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Recent audit log">
        <table className="w-full text-left text-sm" data-testid="audit-table">
          <thead className="text-xs uppercase text-stone-500">
            <tr>
              <th className="py-1">When</th>
              <th>Who</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {recentAudit.map((a) => (
              <tr key={a.id} className="border-t border-stone-100">
                <td className="py-1.5 text-stone-500">{a.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{a.actor?.name ?? "System"}</td>
                <td className="font-mono text-xs">{a.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-stone-800">{title}</h2>
      {children}
    </div>
  );
}
