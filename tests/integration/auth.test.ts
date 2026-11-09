import { seed } from "../../prisma/seed-data";
import { resetDb, testDb } from "../helpers/db";

// Next's cookies() only works inside a request; the nextCookies plugin is a no-op here.
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));

const prisma = testDb();
let auth: typeof import("@/modules/auth/server").auth;

beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
  ({ auth } = await import("@/modules/auth/server"));
});

afterAll(async () => {
  await prisma.$disconnect();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

const reqHeaders = () => new Headers({ "x-request-id": "req-test-1", "x-forwarded-for": "203.0.113.7" });

describe("Better Auth sign-in", () => {
  it("signs in a seeded user, exposes role and orgId, and audits the login", async () => {
    const res = await auth.api.signInEmail({
      body: { email: "manager@acme.test", password: "demo1234" },
      headers: reqHeaders(),
    });
    const user = res.user as typeof res.user & { role: string; orgId: string };
    expect(user.role).toBe("MANAGER");
    expect(user.orgId).toBeTruthy();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "auth.login", actorId: user.id },
    });
    expect(audit.requestId).toBe("req-test-1");
    expect(audit.ip).toBe("203.0.113.7");
  });

  it("rejects a wrong password", async () => {
    await expect(
      auth.api.signInEmail({ body: { email: "manager@acme.test", password: "wrong-pass" }, headers: reqHeaders() }),
    ).rejects.toThrow(/invalid email or password/i);
  });

  it("does not allow self sign-up", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: "intruder@acme.test", password: "abcdefgh1", name: "Intruder" },
        headers: reqHeaders(),
      }),
    ).rejects.toThrow(/not enabled/i);
    expect(await prisma.user.count({ where: { email: "intruder@acme.test" } })).toBe(0);
  });
});
