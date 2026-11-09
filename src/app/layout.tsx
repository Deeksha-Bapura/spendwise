import type { Metadata } from "next";
import { Suspense } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spendwise",
  description: "AI spend management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans">
        {/* Every page is per-user, so the app renders dynamically inside this boundary.
            (Redux's store creation also isn't prerender-safe under Cache Components.) */}
        <Suspense fallback={<div className="p-8 text-sm text-stone-500">Loading…</div>}>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
