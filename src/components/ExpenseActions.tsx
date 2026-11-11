"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { EXPENSE_CATEGORIES, type ExpenseAction } from "@/modules/expenses";

type Props = {
  expenseId: string;
  version: number;
  actions: ExpenseAction[];
  manual: boolean; // manual expenses can edit amount and date; card ones can't
  current: { category: string; description: string; amount: string; spentAt: string };
};

/**
 * Buttons for whatever the server says this user may do next. Every request
 * carries the `version` the user is looking at: if the expense changed in the
 * meantime, the server answers 409 and we ask the user to refresh instead of
 * silently overwriting someone else's change.
 */
export function ExpenseActions({ expenseId, version, actions, manual, current }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(current);

  if (actions.length === 0) return null;

  async function run(name: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      // e.g. discarding a draft makes its transaction expensable again
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      after?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const btn = "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50";
  const input = "mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none";
  const can = (a: ExpenseAction) => actions.includes(a);

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-5" data-testid="expense-actions">
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              "save",
              () =>
                apiFetch(`/api/expenses/${expenseId}`, {
                  method: "PATCH",
                  json: {
                    version,
                    category: form.category,
                    description: form.description,
                    ...(manual ? { amount: form.amount, spentAt: form.spentAt } : {}),
                  },
                }),
              () => setEditing(false),
            );
          }}
        >
          {manual && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Amount
                <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={input} />
              </label>
              <label className="block text-sm">
                Date
                <input type="date" value={form.spentAt} onChange={(e) => setForm({ ...form, spentAt: e.target.value })} className={input} />
              </label>
            </div>
          )}
          <label className="block text-sm">
            Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={!!busy} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={`${btn} text-stone-600 hover:bg-stone-100`}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {can("submit") && (
            <button type="button" disabled={!!busy}
              onClick={() => void run("submit", () => apiFetch(`/api/expenses/${expenseId}/submit`, { method: "POST", json: { version } }))}
              className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
              {busy === "submit" ? "Submitting…" : "Submit for approval"}
            </button>
          )}
          {can("edit") && (
            <button type="button" disabled={!!busy} onClick={() => setEditing(true)} className={`${btn} border border-stone-300 hover:bg-stone-50`}>
              Edit
            </button>
          )}
          {can("discard") && (
            <button type="button" disabled={!!busy}
              onClick={() => void run("discard", () => apiFetch(`/api/expenses/${expenseId}?version=${version}`, { method: "DELETE" }), () => router.push("/expenses"))}
              className={`${btn} text-red-700 hover:bg-red-50`}>
              {busy === "discard" ? "Discarding…" : "Discard draft"}
            </button>
          )}
        </div>
      )}

      {(can("approve") || can("reject")) && (
        <div className="space-y-2 border-t border-stone-100 pt-4">
          <label className="block text-sm">
            Comment <span className="text-stone-500">(required to reject)</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={input} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy}
              onClick={() => void run("approve", () => apiFetch(`/api/expenses/${expenseId}/decision`, { method: "POST", json: { decision: "approve", version, comment } }))}
              className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button type="button" disabled={!!busy}
              onClick={() => void run("reject", () => apiFetch(`/api/expenses/${expenseId}/decision`, { method: "POST", json: { decision: "reject", version, comment } }))}
              className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}{" "}
          <button type="button" onClick={() => { setError(null); router.refresh(); }} className="underline">Refresh</button>
        </p>
      )}
    </div>
  );
}
