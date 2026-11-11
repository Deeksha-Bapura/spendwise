"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { EXPENSE_CATEGORIES } from "@/modules/expenses";
import { useAppDispatch, useAppSelector } from "@/store/store";
import { closeDraft, openDraft, resetDraft, updateDraft } from "@/store/expenseDraftSlice";

/** Manual expense (cash, mileage, anything not on a connected card). Draft state lives in Redux. */
export function NewExpenseForm() {
  const draft = useAppSelector((s) => s.expenseDraft);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!draft.open) {
    return (
      <button
        type="button"
        onClick={() => dispatch(openDraft({ today: new Date().toISOString().slice(0, 10), idempotencyKey: crypto.randomUUID() }))}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        New expense
      </button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>("/api/expenses", {
        method: "POST",
        idempotencyKey: draft.idempotencyKey ?? crypto.randomUUID(),
        json: {
          kind: "manual",
          amount: draft.amount.trim(),
          category: draft.category,
          description: draft.description,
          spentAt: draft.spentAt,
        },
      });
      dispatch(resetDraft());
      router.push(`/expenses/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the expense");
      setSaving(false);
    }
  }

  const input = "mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none";
  return (
    <form onSubmit={save} className="w-full space-y-3 rounded-lg border border-stone-200 bg-white p-5 sm:max-w-md" aria-label="New expense">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Amount (USD)
          <input inputMode="decimal" required placeholder="42.50" value={draft.amount}
            onChange={(e) => dispatch(updateDraft({ amount: e.target.value }))} className={input} />
        </label>
        <label className="block text-sm">
          Date
          <input type="date" required value={draft.spentAt} max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => dispatch(updateDraft({ spentAt: e.target.value }))} className={input} />
        </label>
      </div>
      <label className="block text-sm">
        Category
        <select value={draft.category} onChange={(e) => dispatch(updateDraft({ category: e.target.value }))} className={input}>
          {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        Description
        <input required maxLength={500} placeholder="Client dinner with Acme" value={draft.description}
          onChange={(e) => dispatch(updateDraft({ description: e.target.value }))} className={input} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button type="button" onClick={() => dispatch(closeDraft())} className="rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-stone-100">
          Close (keeps your draft)
        </button>
      </div>
    </form>
  );
}
