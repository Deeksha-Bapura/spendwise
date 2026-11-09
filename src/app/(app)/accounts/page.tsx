import { Suspense } from "react";
import { ConnectBankButton } from "@/components/ConnectBankButton";
import { PageSkeleton } from "@/components/Skeleton";
import { SyncNowButton } from "@/components/SyncNowButton";
import { plaidConfigured } from "@/lib/env";
import { listItemsForUser } from "@/modules/banking";
import { requireUser } from "@/modules/auth/server";

export const metadata = { title: "Bank accounts · Spendwise" };

export default function AccountsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Accounts />
    </Suspense>
  );
}

const STATUS_LABEL = { ACTIVE: "Connected", LOGIN_REQUIRED: "Reconnect needed", REVOKED: "Disconnected" } as const;

async function Accounts() {
  const user = await requireUser();
  const items = await listItemsForUser(user.id);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Bank accounts</h1>
          <p className="mt-1 text-sm text-stone-600">
            Your personal bank connections. Only you can sync them.
          </p>
        </div>
        <ConnectBankButton enabled={plaidConfigured()} />
      </div>

      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600">
          No banks connected yet.
        </p>
      )}

      <ul className="space-y-4" data-testid="bank-items">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {item.institutionName ?? "Bank"}
                  {item.isDemo && (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                      Demo data
                    </span>
                  )}
                </p>
                <p className="text-xs text-stone-500">
                  {STATUS_LABEL[item.status]}
                  {item.lastSyncedAt && ` · last synced ${item.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}
                  {item.lastSyncError && ` · last error: ${item.lastSyncError}`}
                </p>
              </div>
              {!item.isDemo && <SyncNowButton itemId={item.id} />}
            </div>
            <ul className="mt-3 divide-y divide-stone-100 text-sm">
              {item.accounts.map((a) => (
                <li key={a.id} className="flex justify-between py-1.5">
                  <span>
                    {a.name} {a.mask && <span className="text-stone-500">••{a.mask}</span>}
                  </span>
                  <span className="text-stone-500">{a._count.transactions} transactions</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
