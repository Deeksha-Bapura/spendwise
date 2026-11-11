"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

/** Turn one of your card transactions into a draft expense. */
export function ExpenseItButton({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function go() {
    setState("busy");
    key.current ??= crypto.randomUUID(); // same key if clicked twice: one expense
    try {
      const created = await apiFetch<{ id: string }>("/api/expenses", {
        method: "POST",
        idempotencyKey: key.current,
        json: { kind: "transaction", transactionId },
      });
      // Next.js keeps this page alive in the background, so reset the button and
      // refetch the list: the row should say "Expensed" when the user comes back.
      setState("idle");
      key.current = null;
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      router.push(`/expenses/${created.id}`);
    } catch {
      setState("error");
    }
  }

  return (
    <button type="button" onClick={() => void go()} disabled={state === "busy"}
      className="rounded-md border border-brand-100 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-900 hover:bg-brand-100 disabled:opacity-50">
      {state === "busy" ? "Creating…" : state === "error" ? "Retry" : "Expense it"}
    </button>
  );
}
