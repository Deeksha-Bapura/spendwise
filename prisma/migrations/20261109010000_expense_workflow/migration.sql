-- DropIndex
DROP INDEX "Expense_orgId_status_idx";

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Expense_orgId_status_submittedAt_idx" ON "Expense"("orgId", "status", "submittedAt");
