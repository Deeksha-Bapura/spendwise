"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { formatCents } from "@/lib/money";

type Row = {
  id: string;
  postedAt: string;
  merchantName: string | null;
  description: string;
  amountCents: string;
  currency: string;
  pending: boolean;
  plaidCategory: string | null;
  account: { name: string; mask: string | null };
  owner: { id: string; name: string };
};
type Page = { rows: Row[]; nextCursor: string | null };

async function fetchPage(cursor: string | null): Promise<Page> {
  const params = new URLSearchParams({ limit: "25" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/transactions?${params}`);
  if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
  return res.json() as Promise<Page>;
}

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Server data via TanStack Query: cached, deduped, and paged with a keyset cursor. */
export function TransactionsTable({ showOwner }: { showOwner: boolean }) {
  const query = useInfiniteQuery({
    queryKey: ["transactions"],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  if (query.isPending) return <p className="text-sm text-stone-500">Loading transactions…</p>;
  if (query.isError) return <p role="alert" className="text-sm text-red-700">{query.error.message}</p>;

  const rows = query.data.pages.flatMap((p) => p.rows);
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600">
        No transactions yet. Connect a bank on the Bank accounts page.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm" data-testid="transactions-table">
          <thead className="border-b border-stone-200 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Merchant</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Account</th>
              {showOwner && <th className="px-4 py-2">Owner</th>}
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const cents = BigInt(t.amountCents);
              // Plaid convention: positive = money out. Show inflows in green with a +.
              const inflow = cents < 0n;
              return (
                <tr key={t.id} className="border-t border-stone-100" data-testid="transaction-row">
                  <td className="whitespace-nowrap px-4 py-2 text-stone-500">{t.postedAt.slice(0, 10)}</td>
                  <td className="px-4 py-2">
                    <span className="font-medium">{t.merchantName ?? t.description}</span>
                    {t.pending && (
                      <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-stone-600">{t.plaidCategory ? titleCase(t.plaidCategory) : "—"}</td>
                  <td className="px-4 py-2 text-stone-600">
                    {t.account.name} {t.account.mask && `••${t.account.mask}`}
                  </td>
                  {showOwner && <td className="px-4 py-2" data-testid="transaction-owner">{t.owner.name}</td>}
                  <td className={`whitespace-nowrap px-4 py-2 text-right font-mono ${inflow ? "text-brand-700" : ""}`}>
                    {inflow ? `+${formatCents(-cents, t.currency)}` : formatCents(cents, t.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
