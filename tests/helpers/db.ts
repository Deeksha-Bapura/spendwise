import { createPrismaClient } from "@/lib/db";

export function testDb() {
  return createPrismaClient(process.env.DATABASE_URL!);
}

/**
 * Wipe every app table in the test database. AuditLog's append-only triggers
 * are disabled only for the duration of this reset (test DB only).
 */
export async function resetDb(prisma: ReturnType<typeof testDb>) {
  if (!process.env.DATABASE_URL?.includes("test")) {
    throw new Error("resetDb refused: DATABASE_URL does not look like a test database");
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`);
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE "AuditLog", "IdempotencyKey", "OutboxEvent", "WebhookEvent", "Approval",
        "Expense", "Transaction", "BankAccount", "PlaidItem", "Policy", "Session",
        "Account", "Verification", "Team", "User", "Organization" CASCADE`);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER USER`);
  }
}
