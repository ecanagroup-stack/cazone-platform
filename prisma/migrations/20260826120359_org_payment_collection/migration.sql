-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutAccountName" TEXT,
ADD COLUMN     "payoutAccountNumber" TEXT,
ADD COLUMN     "payoutBankCode" TEXT,
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "paystackSubaccountCode" TEXT;

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "paymentCollectionFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 1.5;
