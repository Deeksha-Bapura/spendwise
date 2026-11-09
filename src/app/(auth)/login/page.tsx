import { redirect } from "next/navigation";
import { Suspense } from "react";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth/server";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Spendwise" };

/** Only allow same-site relative paths, so ?next= can't redirect off-site. */
function safeNext(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

// The card frame is static. The form depends on the URL (?next=) and the
// session, so it renders inside a Suspense boundary.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-brand-900">Sign in to Spendwise</h1>
        <Suspense fallback={<div className="mt-6 h-64 animate-pulse rounded-md bg-stone-100" aria-busy="true" />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  const e = env();
  return (
    <LoginForm
      next={next}
      demoMode={e.DEMO_MODE}
      githubEnabled={Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET)}
    />
  );
}
