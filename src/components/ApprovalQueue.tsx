"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatCents } from "@/lib/money";

type Row = {
  id: string;
  version: number;
  amountCents: string;
  currency: string;
  category: string;
  description: string;
  spentAt: string;
  submittedAt: string | null;
  submitter: { name: string; team: string | null };
};

/** Approve in one click from the queue; rejecting asks for a reason. */
export function ApprovalQueue({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-600" data-testid="queue-empty">
        Nothing waiting for you. Nice.
      </p>
    );
  }

  async function decide(row: Row, decision: "approve" | "reject", comment?: string) {
    setBusy(row.id);
    try {
      await apiFetch(`/api/expenses/${row.id}/decision`, { method: "POST", json: { decision, version: row.version, comment } });
      setRejecting(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setMessages((m) => ({ ...m, [row.id]: err instanceof Error ? err.message : "Failed" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-3" data-testid="approval-queue">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-stone-200 bg-white p-4" data-testid="queue-item">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/expenses/${row.id}`} className="font-medium text-brand-700 hover:underline">{row.description}</Link>
              <p className="text-xs text-stone-500">
                {row.submitter.name}{row.submitter.team && ` · ${row.submitter.team}`} · {row.category} · spent {row.spentAt.slice(0, 10)}
                {row.submittedAt && ` · submitted ${row.submittedAt.slice(0, 10)}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-semibold">{formatCents(BigInt(row.amountCents), row.currency)}</span>
              <button type="button" disabled={busy === row.id} onClick={() => void decide(row, "approve")}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                Approve
              </button>
              <button type="button" disabled={busy === row.id} onClick={() => setRejecting(rejecting === row.id ? null : row.id)}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
          {rejecting === row.id && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void decide(row, "reject", reason); }}>
              <input autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejecting"
                aria-label="Reason for rejecting" className="flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm" />
              <button type="submit" disabled={busy === row.id} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                Confirm reject
              </button>
            </form>
          )}
          {messages[row.id] && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {messages[row.id]} <button type="button" className="underline" onClick={() => router.refresh()}>Refresh</button>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
