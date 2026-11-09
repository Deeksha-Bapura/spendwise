-- AlterTable
ALTER TABLE "PlaidItem" ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "plaidCategory" TEXT;
