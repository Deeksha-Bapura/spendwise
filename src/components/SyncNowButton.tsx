"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncResponse =
  | { status: "synced"; upserted: number; removed: number; skipped: number }
  | { status: "superseded" | "skipped"; reason?: string }
  | { error: string; code?: string | null };

export function SyncNowButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/plaid/items/${itemId}/sync`, { method: "POST" });
      const body = (await res.json()) as SyncResponse;
      if ("error" in body) setMessage(body.code ? `Sync failed (${body.code})` : "Sync failed");
      else if (body.status === "synced")
        setMessage(`Synced: ${body.upserted} new or updated, ${body.removed} removed`);
      else if (body.status === "superseded") setMessage("Another sync just finished. You're up to date.");
      else setMessage(body.reason ?? "Nothing to sync");
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      router.refresh();
    } catch {
      setMessage("Sync failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-3">
      {message && <span role="status" className="text-xs text-stone-600">{message}</span>}
      <button
        type="button"
        onClick={() => void sync()}
        disabled={pending}
        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
    </span>
  );
}
