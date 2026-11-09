import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ForbiddenError, UnauthorizedError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getRequestContext } from "@/lib/request-context";
import { auth } from "./auth";
import { can, isRole, type Action, type Actor, type Resource, type Role } from "./rbac";

export type CurrentUser = Actor & { name: string; email: string; role: Role };

/** The signed-in user, or null. Reads the session from the database every time. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & {
    role?: unknown;
    orgId?: string | null;
    teamId?: string | null;
  };
  if (!isRole(u.role) || !u.orgId) {
    logger.error({ userId: u.id }, "session user missing role or orgId");
    return null;
  }
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    orgId: u.orgId,
    teamId: u.teamId ?? null,
  };
}

/** For pages and layouts: redirect to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For route handlers and server actions: throw 401 when signed out. */
export async function requireApiUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Throw ForbiddenError (403) unless `user` may perform `action` on `resource`.
 * Every denial is logged with the request id, so probing shows up in logs.
 */
export async function requirePermission(
  user: CurrentUser,
  action: Action,
  resource?: Resource,
): Promise<void> {
  if (can(user, action, resource)) return;
  const { requestId, ip } = await getRequestContext();
  logger.warn(
    { requestId, ip, userId: user.id, role: user.role, action, resourceOrg: resource?.orgId },
    "permission denied",
  );
  throw new ForbiddenError();
}
