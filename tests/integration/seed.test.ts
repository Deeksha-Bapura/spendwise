import { seed } from "../../prisma/seed-data";
import { resetDb, testDb } from "../helpers/db";

const prisma = testDb();

beforeAll(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

async function counts() {
  const [orgs, teams, users, accounts, policies] = await Promise.all([
    prisma.organization.count(),
    prisma.team.count(),
    prisma.user.count(),
    prisma.account.count(),
    prisma.policy.count(),
  ]);
  return { orgs, teams, users, accounts, policies };
}

describe("seed", () => {
  it("creates the demo org", async () => {
    await seed(prisma);
    expect(await counts()).toEqual({ orgs: 1, teams: 3, users: 10, accounts: 10, policies: 2 });
  });

  it("is idempotent: a second run changes nothing", async () => {
    const before = await counts();
    const passwordsBefore = await prisma.account.findMany({ select: { id: true, password: true }, orderBy: { id: "asc" } });
    await seed(prisma);
    expect(await counts()).toEqual(before);
    const passwordsAfter = await prisma.account.findMany({ select: { id: true, password: true }, orderBy: { id: "asc" } });
    expect(passwordsAfter).toEqual(passwordsBefore);
  });

  it("gives every team a manager with the MANAGER role", async () => {
    const teams = await prisma.team.findMany({ include: { manager: true } });
    for (const t of teams) expect(t.manager?.role).toBe("MANAGER");
  });

  it("has exactly one of each demo role", async () => {
    const demo = await prisma.user.findMany({
      where: { email: { in: ["employee@acme.test", "manager@acme.test", "finance@acme.test"] } },
      select: { role: true },
    });
    expect(demo.map((u) => u.role).sort()).toEqual(["EMPLOYEE", "FINANCE_ADMIN", "MANAGER"]);
  });
});
