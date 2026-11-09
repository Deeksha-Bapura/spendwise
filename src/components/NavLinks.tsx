import Link from "next/link";
import { navLinksFor, type Role } from "@/modules/auth";

export function NavLinks({ role, currentPath }: { role: Role; currentPath?: string }) {
  return (
    <nav aria-label="Main">
      <ul className="flex gap-1">
        {navLinksFor(role).map((link) => {
          const active = currentPath === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  active ? "bg-brand-100 text-brand-900" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
