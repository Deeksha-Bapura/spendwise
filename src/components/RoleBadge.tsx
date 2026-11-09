import type { Role } from "@/modules/auth";

const LABELS: Record<Role, string> = {
  EMPLOYEE: "Employee",
  MANAGER: "Manager",
  FINANCE_ADMIN: "Finance admin",
};

export function roleLabel(role: Role) {
  return LABELS[role];
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
      {LABELS[role]}
    </span>
  );
}
