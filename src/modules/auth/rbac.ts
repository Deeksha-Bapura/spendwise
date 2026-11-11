/**
 * Role-based access control: the single source of truth for who can do what.
 * Pure functions with no I/O, so they're cheap to unit test exhaustively.
 * Every server entry point (route handler, server action, page) calls these.
 */

export const ROLES = ["EMPLOYEE", "MANAGER", "FINANCE_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export type Actor = {
  id: string;
  orgId: string;
  teamId: string | null;
  role: Role;
};

/** A resource being acted on. Ownership fields drive the row-level rules. */
export type Resource = {
  orgId: string;
  ownerId?: string; // e.g. Expense.submitterId
  teamId?: string | null; // the owner's team
};

export const ACTIONS = [
  "transaction:read",
  "bank:connect",
  "bank:sync",
  "expense:read",
  "expense:create",
  "expense:approve",
  "expense:reimburse",
  "policy:read",
  "policy:manage",
  "audit:read",
  "admin:access",
] as const;
export type Action = (typeof ACTIONS)[number];

type Rule = (actor: Actor, resource?: Resource) => boolean;

const own: Rule = (a, r) => !r || r.ownerId === a.id;
const ownOrTeam: Rule = (a, r) =>
  !r || r.ownerId === a.id || (a.teamId !== null && r.teamId === a.teamId);
const always: Rule = () => true;
const never: Rule = () => false;
/** Managers approve their team's expenses, never their own. */
const teamNotSelf: Rule = (a, r) =>
  !!r && r.ownerId !== a.id && a.teamId !== null && r.teamId === a.teamId;
/** Finance admins can act org-wide, but still never on their own expense. */
const notSelf: Rule = (a, r) => !!r && r.ownerId !== a.id;

const PERMISSIONS: Record<Role, Record<Action, Rule>> = {
  EMPLOYEE: {
    "transaction:read": own,
    "bank:connect": always,
    "bank:sync": own,
    "expense:read": own,
    "expense:create": always,
    "expense:approve": never,
    "expense:reimburse": never,
    "policy:read": always,
    "policy:manage": never,
    "audit:read": never,
    "admin:access": never,
  },
  MANAGER: {
    "transaction:read": ownOrTeam,
    "bank:connect": always,
    "bank:sync": own,
    "expense:read": ownOrTeam,
    "expense:create": always,
    "expense:approve": teamNotSelf,
    "expense:reimburse": never,
    "policy:read": always,
    "policy:manage": never,
    "audit:read": never,
    "admin:access": never,
  },
  FINANCE_ADMIN: {
    "transaction:read": always,
    "bank:connect": always,
    "bank:sync": own, // connections are personal: even admins can't sync someone else's bank
    "expense:read": always,
    "expense:create": always,
    "expense:approve": notSelf,
    "expense:reimburse": notSelf,
    "policy:read": always,
    "policy:manage": always,
    "audit:read": always,
    "admin:access": always,
  },
};

/**
 * Can `actor` perform `action` (optionally on `resource`)?
 * Cross-org access is always denied, before any role rule runs.
 */
export function can(actor: Actor, action: Action, resource?: Resource): boolean {
  if (resource && resource.orgId !== actor.orgId) return false;
  const rule = PERMISSIONS[actor.role]?.[action];
  return rule ? rule(actor, resource) : false;
}

export type NavLink = { href: string; label: string };

/** Navigation for each role. UI only; the server still checks `can()`. */
export function navLinksFor(role: Role): NavLink[] {
  const links: NavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/transactions", label: "Transactions" },
    { href: "/expenses", label: "Expenses" },
  ];
  if (role === "MANAGER" || role === "FINANCE_ADMIN") {
    links.push({ href: "/approvals", label: "Approvals" });
  }
  links.push({ href: "/accounts", label: "Bank accounts" });
  if (role === "FINANCE_ADMIN") {
    links.push({ href: "/admin", label: "Admin" });
  }
  return links;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
