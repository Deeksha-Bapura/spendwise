"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";

/**
 * Opens Plaid Link, then sends the public token to /api/plaid/exchange.
 * One Idempotency-Key per public token: if the exchange request is retried
 * (double click, flaky network), the server returns the first result instead
 * of exchanging the single-use token twice.
 */
export function ConnectBankButton({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "linking" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const keysByToken = useRef(new Map<string, string>());

  const exchange = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setStatus("saving");
      let key = keysByToken.current.get(publicToken);
      if (!key) {
        key = crypto.randomUUID();
        keysByToken.current.set(publicToken, key);
      }
      const res = await fetch("/api/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ publicToken, institutionName: metadata.institution?.name ?? null }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage("Couldn't save the connection. Try again.");
        return;
      }
      setStatus("idle");
      setLinkToken(null);
      setMessage(`Connected ${metadata.institution?.name ?? "your bank"}. Transactions can take a minute to appear.`);
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      router.refresh();
    },
    [queryClient, router],
  );

  async function start() {
    setStatus("starting");
    setMessage(null);
    const res = await fetch("/api/plaid/link-token", { method: "POST" });
    if (!res.ok) {
      setStatus("error");
      setMessage(res.status === 503 ? "Plaid isn't configured on this server." : "Couldn't start Plaid Link.");
      return;
    }
    setLinkToken(((await res.json()) as { linkToken: string }).linkToken);
    setStatus("linking");
  }

  const busy = status === "starting" || status === "linking" || status === "saving";
  return (
    <div className="space-y-2">
      {linkToken && status === "linking" && (
        <PlaidLinkLauncher
          token={linkToken}
          onSuccess={(publicToken, metadata) => {
            if (!publicToken) {
              setStatus("error");
              setMessage("Plaid didn't return a token. Try again.");
              return;
            }
            void exchange(publicToken, metadata);
          }}
          onExit={() => {
            setStatus("idle");
            setLinkToken(null);
          }}
        />
      )}
      <button
        type="button"
        onClick={() => void start()}
        disabled={!enabled || busy}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {status === "saving" ? "Saving connection…" : busy ? "Opening Plaid…" : "Connect a bank"}
      </button>
      {!enabled && (
        <p className="text-xs text-stone-500">
          Set PLAID_CLIENT_ID and PLAID_SECRET in .env to connect a sandbox bank.
        </p>
      )}
      {message && (
        <p role="status" className={`text-sm ${status === "error" ? "text-red-700" : "text-stone-700"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

/** Mounted only once a link token exists; opens Plaid Link as soon as it's ready. */
function PlaidLinkLauncher(props: {
  token: string;
  onSuccess: (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({ token: props.token, onSuccess: props.onSuccess, onExit: props.onExit });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}
