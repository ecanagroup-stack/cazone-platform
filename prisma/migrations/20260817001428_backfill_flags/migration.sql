-- AlterTable
ALTER TABLE "CashDeposit" ADD COLUMN     "isBackfill" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "isBackfill" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reconciliation" ADD COLUMN     "isBackfill" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "isBackfill" BOOLEAN NOT NULL DEFAULT false;
