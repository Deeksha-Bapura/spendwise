// Public API of the auth module. Other modules import from "@/modules/auth" only.
// Server-only pieces (auth instance, session helpers) live in "@/modules/auth/server".
export { can, navLinksFor, isRole, ROLES, ACTIONS } from "./rbac";
export type { Role, Action, Actor, Resource, NavLink } from "./rbac";
