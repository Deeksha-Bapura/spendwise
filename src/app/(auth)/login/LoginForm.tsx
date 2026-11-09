"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/modules/auth/client";

const DEMO_USERS = [
  { label: "Employee", email: "employee@acme.test" },
  { label: "Manager", email: "manager@acme.test" },
  { label: "Finance Admin", email: "finance@acme.test" },
];
const DEMO_PASSWORD = "demo1234";

type Props = { next: string; demoMode: boolean; githubEnabled: boolean };

export function LoginForm({ next, demoMode, githubEnabled }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(email: string, password: string) {
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError("Incorrect email or password.");
      setPending(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void signIn(String(form.get("email")), String(form.get("password")));
        }}
      >
        <label className="block text-sm">
          <span className="text-stone-700">Email</span>
          <input name="email" type="email" required autoComplete="email"
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 focus:border-brand-600 focus:outline-none" />
        </label>
        <label className="block text-sm">
          <span className="text-stone-700">Password</span>
          <input name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 focus:border-brand-600 focus:outline-none" />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {githubEnabled && (
        <button type="button"
          onClick={() => authClient.signIn.social({ provider: "github", callbackURL: next })}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50">
          Continue with GitHub
        </button>
      )}

      {demoMode && (
        <div className="border-t border-stone-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Demo accounts</p>
          <div className="mt-2 grid gap-2">
            {DEMO_USERS.map((u) => (
              <button key={u.email} type="button" disabled={pending}
                onClick={() => void signIn(u.email, DEMO_PASSWORD)}
                className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900 hover:bg-brand-100 disabled:opacity-50">
                Sign in as {u.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
