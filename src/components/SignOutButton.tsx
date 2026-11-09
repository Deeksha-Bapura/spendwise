"use client";

import { useState } from "react";
import { authClient } from "@/modules/auth/client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
      // Full reload, not a client-side navigation: it clears every in-memory
      // cache (React Query, Redux, routes Next.js keeps alive), so nothing from
      // this user's session survives in the tab.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload on sign-out
      window.location.assign("/login");
    } catch (err) {
      console.error("Sign-out failed", err);
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {failed && (
        <span role="status" className="text-xs text-red-700">
          Couldn&apos;t sign out. Try again.
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => void signOut()}
        className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </span>
  );
}
