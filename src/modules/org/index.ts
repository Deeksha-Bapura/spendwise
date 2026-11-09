import "server-only";
import { db } from "@/lib/db";

export async function getUserProfile(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      org: { select: { id: true, name: true } },
      team: { select: { id: true, name: true, manager: { select: { name: true } } } },
    },
  });
}

/** Finance-admin overview. Caller must check "admin:access" first. */
export async function getOrgOverview(orgId: string) {
  const [roleCounts, teams, policies, recentAudit] = await Promise.all([
    db.user.groupBy({ by: ["role"], where: { orgId }, _count: { _all: true } }),
    db.team.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, manager: { select: { name: true } }, _count: { select: { members: true } } },
    }),
    db.policy.findMany({
      where: { orgId, active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, text: true },
    }),
    db.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, createdAt: true, actor: { select: { name: true } } },
    }),
  ]);
  return { roleCounts, teams, policies, recentAudit };
}
