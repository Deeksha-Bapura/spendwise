import Link from "next/link";

export function Forbidden() {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-lg border border-stone-200 bg-white p-8 text-center">
      <p className="text-sm font-semibold text-red-700">403</p>
      <h1 className="mt-1 text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-stone-600">Your role doesn&apos;t include this page.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-700 underline">
        Back to dashboard
      </Link>
    </div>
  );
}
