import { seed } from "../../prisma/seed-data";
import { recordAudit } from "@/modules/audit";
import { resetDb, testDb } from "../helpers/db";

const prisma = testDb();
let orgId: string;
let actorId: string;

beforeAll(async () => {
  await resetDb(prisma);
  const s = await seed(prisma);
  orgId = s.orgId;
  actorId = s.userIds["finance@acme.test"]!;
});

afterAll(() => prisma.$disconnect());

describe("AuditLog is append-only", () => {
  let id: string;

  beforeAll(async () => {
    const row = await recordAudit(prisma, {
      orgId,
      actorId,
      action: "test.created",
      entity: { type: "Test", id: "t1" },
      after: { amountCents: 7500n, at: new Date("2026-01-01T00:00:00Z") },
    });
    id = row.id;
  });

  it("stores bigint cents and dates as JSON-safe values", async () => {
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row.after).toEqual({ amountCents: "7500", at: "2026-01-01T00:00:00.000Z" });
  });

  it("rejects UPDATE", async () => {
    await expect(
      prisma.auditLog.update({ where: { id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE", async () => {
    await expect(prisma.auditLog.delete({ where: { id } })).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE", async () => {
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
  });

  it("the row is unchanged after the attempts", async () => {
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row.action).toBe("test.created");
  });
});

describe("recordAudit is atomic with the change it describes", () => {
  it("rolls back together with its parent transaction", async () => {
    const before = await prisma.auditLog.count({ where: { action: "policy.created" } });
    const policiesBefore = await prisma.policy.count();

    await expect(
      prisma.$transaction(async (tx) => {
        const policy = await tx.policy.create({
          data: { orgId, text: "No first-class flights", createdById: actorId },
        });
        await recordAudit(tx, {
          orgId,
          actorId,
          action: "policy.created",
          entity: { type: "Policy", id: policy.id },
          after: policy,
        });
        throw new Error("boom: simulate a failure after both writes");
      }),
    ).rejects.toThrow("boom");

    expect(await prisma.auditLog.count({ where: { action: "policy.created" } })).toBe(before);
    expect(await prisma.policy.count()).toBe(policiesBefore);
  });

  it("commits together when the transaction succeeds", async () => {
    await prisma.$transaction(async (tx) => {
      const policy = await tx.policy.create({
        data: { orgId, text: "Hotels under $300/night", createdById: actorId },
      });
      await recordAudit(tx, {
        orgId,
        actorId,
        action: "policy.created",
        entity: { type: "Policy", id: policy.id },
        after: policy,
      });
    });
    expect(await prisma.auditLog.count({ where: { action: "policy.created" } })).toBe(1);
  });
});
