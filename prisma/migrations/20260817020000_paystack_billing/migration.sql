-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "paystackPlanCode" TEXT,
ADD COLUMN     "paystackPlanAmount" INTEGER;

-- AlterTable
ALTER TABLE "ProvisioningRequest" ADD COLUMN     "paystackReference" TEXT;

-- CreateTable
CREATE TABLE "PaystackEvent" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaystackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaystackEvent_reference_key" ON "PaystackEvent"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ProvisioningRequest_paystackReference_key" ON "ProvisioningRequest"("paystackReference");
