import { hashPassword } from "better-auth/crypto";
import { encryptSecret } from "../src/lib/crypto";
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

  const demoBanking = await seedDemoBanking(prisma, org.id, userIds);

  return { orgId: org.id, teamIds, userIds, ...demoBanking };
}

/* ───────────── Demo bank data ─────────────
 * Seeded "Demo Bank" connections with realistic transactions, so the app has
 * data without Plaid keys (CI, and recruiters trying the live demo). Demo
 * items are marked by the "demo_" prefix and are never synced with Plaid.
 */

/** Users who get a demo bank: chosen to exercise every visibility rule. */
const DEMO_BANK_USERS = [
  DEMO_ACCOUNTS.employee, // Engineering
  "eli@acme.test", // Engineering teammate → visible to the Engineering manager
  DEMO_ACCOUNTS.manager, // Engineering manager
  "sam@acme.test", // Sales → NOT visible to the Engineering manager
];
export const DEMO_TRANSACTIONS_PER_USER = 30;

// [merchant, Plaid primary category, min $, max $]
const MERCHANTS: [string, string, number, number][] = [
  ["Uber", "TRANSPORTATION", 12, 64],
  ["Lyft", "TRANSPORTATION", 9, 48],
  ["Delta Air Lines", "TRAVEL", 180, 640],
  ["Hilton Hotels", "TRAVEL", 140, 420],
  ["Starbucks", "FOOD_AND_DRINK", 4, 18],
  ["Sweetgreen", "FOOD_AND_DRINK", 12, 28],
  ["The Capital Grille", "FOOD_AND_DRINK", 60, 240],
  ["Amazon Web Services", "GENERAL_SERVICES", 40, 900],
  ["Figma", "GENERAL_SERVICES", 15, 75],
  ["Staples", "GENERAL_MERCHANDISE", 8, 120],
  ["WeWork", "RENT_AND_UTILITIES", 300, 650],
];

/** Small deterministic PRNG (mulberry32), so every seed run makes the same data. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seedDemoBanking(prisma: PrismaClient, orgId: string, userIds: Record<string, string>) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let transactions = 0;

  for (const [u, email] of DEMO_BANK_USERS.entries()) {
    const userId = userIds[email]!;
    const local = email.split("@")[0]!.replace(/[^a-z]/g, "");
    const plaidItemId = `demo_item_${local}`;

    const item = await prisma.plaidItem.upsert({
      where: { plaidItemId },
      update: {},
      create: {
        orgId,
        userId,
        plaidItemId,
        accessTokenEncrypted: encryptSecret("demo-not-a-real-token", plaidItemId),
        institutionName: "Demo Bank",
        syncCursor: "demo",
        lastSyncedAt: today,
      },
    });
    const account = await prisma.bankAccount.upsert({
      where: { plaidAccountId: `demo_acct_${local}` },
      update: {},
      create: {
        orgId,
        plaidItemId: item.id,
        plaidAccountId: `demo_acct_${local}`,
        name: "Corporate Card",
        mask: String(4100 + u * 7).slice(-4),
        type: "credit/credit card",
      },
    });

    const rand = rng(1000 + u);
    for (let i = 0; i < DEMO_TRANSACTIONS_PER_USER; i++) {
      const [merchant, category, min, max] = MERCHANTS[Math.floor(rand() * MERCHANTS.length)]!;
      const cents = BigInt(Math.round((min + rand() * (max - min)) * 100));
      const postedAt = new Date(today.getTime() - Math.floor(i * 2 + rand() * 2) * 86_400_000);
      await prisma.transaction.upsert({
        where: { plaidTransactionId: `demo_txn_${local}_${i}` },
        update: {},
        create: {
          orgId,
          accountId: account.id,
          plaidTransactionId: `demo_txn_${local}_${i}`,
          amountCents: cents,
          currency: "USD",
          merchantName: merchant,
          rawDescription: merchant.toUpperCase(),
          postedAt,
          pending: i < 2,
          plaidCategory: category,
        },
      });
      transactions++;
    }
  }
  return { demoBankUsers: DEMO_BANK_USERS.length, demoTransactions: transactions };
}
