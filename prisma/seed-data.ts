import { hashPassword } from "better-auth/crypto";
import type { PrismaClient, Role } from "../src/generated/prisma/client";

export const DEMO_PASSWORD = "demo1234";

export const DEMO_ACCOUNTS = {
  employee: "employee@acme.test",
  manager: "manager@acme.test",
  finance: "finance@acme.test",
} as const;

type SeedUser = { email: string; name: string; role: Role; team: TeamName };
type TeamName = "Engineering" | "Sales" | "Operations";

const TEAMS: TeamName[] = ["Engineering", "Sales", "Operations"];

const USERS: SeedUser[] = [
  // Demo logins
  { email: DEMO_ACCOUNTS.employee, name: "Emma Employee", role: "EMPLOYEE", team: "Engineering" },
  { email: DEMO_ACCOUNTS.manager, name: "Marcus Manager", role: "MANAGER", team: "Engineering" },
  { email: DEMO_ACCOUNTS.finance, name: "Fiona Finance", role: "FINANCE_ADMIN", team: "Operations" },
  // Other managers
  { email: "sara.sales.mgr@acme.test", name: "Sara Lopez", role: "MANAGER", team: "Sales" },
  { email: "omar.ops.mgr@acme.test", name: "Omar Haddad", role: "MANAGER", team: "Operations" },
  // Other employees
  { email: "eli@acme.test", name: "Eli Chen", role: "EMPLOYEE", team: "Engineering" },
  { email: "sam@acme.test", name: "Sam Patel", role: "EMPLOYEE", team: "Sales" },
  { email: "sofia@acme.test", name: "Sofia Rossi", role: "EMPLOYEE", team: "Sales" },
  { email: "olivia@acme.test", name: "Olivia Brown", role: "EMPLOYEE", team: "Operations" },
  { email: "noah@acme.test", name: "Noah Kim", role: "EMPLOYEE", team: "Operations" },
];

const MANAGER_OF: Record<TeamName, string> = {
  Engineering: DEMO_ACCOUNTS.manager,
  Sales: "sara.sales.mgr@acme.test",
  Operations: "omar.ops.mgr@acme.test",
};

const POLICIES = [
  { id: "seed-policy-meals", text: "No meals over $75 per person" },
  { id: "seed-policy-flights", text: "Flights must be economy class" },
];

/**
 * Idempotent: every write is an upsert or a create-if-missing, so running the
 * seed twice leaves the same rows (and doesn't re-hash existing passwords).
 */
export async function seed(prisma: PrismaClient) {
  const org = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: { name: "Acme Inc.", slug: "acme" },
  });

  const teamIds = {} as Record<TeamName, string>;
  for (const name of TEAMS) {
    const team = await prisma.team.upsert({
      where: { orgId_name: { orgId: org.id, name } },
      update: {},
      create: { orgId: org.id, name },
    });
    teamIds[name] = team.id;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds: Record<string, string> = {};

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, teamId: teamIds[u.team], orgId: org.id },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        emailVerified: true,
        orgId: org.id,
        teamId: teamIds[u.team],
      },
    });
    userIds[u.email] = user.id;

    // Better Auth stores email/password credentials in Account (providerId "credential").
    const existing = await prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { id: true },
    });
    if (!existing) {
      await prisma.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }
  }

  for (const name of TEAMS) {
    await prisma.team.update({
      where: { id: teamIds[name] },
      data: { managerId: userIds[MANAGER_OF[name]] },
    });
  }

  for (const p of POLICIES) {
    await prisma.policy.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        orgId: org.id,
        text: p.text,
        createdById: userIds[DEMO_ACCOUNTS.finance]!,
      },
    });
  }

  return { orgId: org.id, teamIds, userIds };
}
