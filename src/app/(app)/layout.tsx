import { Suspense } from "react";
import { NavLinks } from "@/components/NavLinks";
import { RoleBadge } from "@/components/RoleBadge";
import { SignOutButton } from "@/components/SignOutButton";
import { requireUser } from "@/modules/auth/server";

/**
 * The header frame is static and prerenders into the shell. Everything that
 * reads the session streams in behind a Suspense boundary, as Cache Components
 * requires. Pages do their own requireUser() check too, so access control
 * never depends on this layout.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <span className="text-lg font-semibold tracking-tight text-brand-900">Spendwise</span>
          <Suspense fallback={<div className="h-8 w-64 animate-pulse rounded-md bg-stone-100" />}>
            <HeaderSession />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

async function HeaderSession() {
  const user = await requireUser();
  return (
    <div className="flex flex-1 items-center justify-between gap-6 pl-6">
      <NavLinks role={user.role} />
      <div className="flex items-center gap-3">
        <span className="text-sm text-stone-700" data-testid="current-user">{user.name}</span>
        <RoleBadge role={user.role} />
        <SignOutButton />
      </div>
    </div>
  );
}